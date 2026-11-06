import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useNavigate } from "@tanstack/react-router";
import { CloudDownloadIcon, CloudUploadIcon } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useScratchProject } from "../../hooks/useScratchProject";
import { useMergedSettings } from "../../hooks/useSettings";
import { cn, newMessageId, newThreadId } from "../../lib/utils";
import {
  resolveDefaultProviderModelSelection,
  resolveProjectDefaultProviderModelSelection,
} from "../../providerInstances";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import { primaryServerProvidersAtom, primaryServerSettingsAtom } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { resolveDesktopUpdateButtonAction } from "../desktopUpdate.logic";
import { SidebarMenuItem } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarUpdatePill } from "./SidebarUpdatePill";
import { useUpdateEverythingRun } from "./updateEverythingRun";

// Project Ares: team kit buttons. The prompts use only $HOME paths so they run on any machine.
const KIT_SCRIPT = "$HOME/.claude/hooks/uefnclaw/kit.ps1";
const KIT_REPO = "https://github.com/sendtokade-boop/lastmade-uefnclaw-harness.git";

const PUSH_PROMPT = `Push the Project ARES kit (rules, skills, agents, commands, hooks, tools) from this machine to GitHub.

1. If \`${KIT_SCRIPT}\` does not exist, the kit is not installed here, so there is nothing to push: say so and stop.
2. Follow \`$HOME/.claude/commands/kit-ship.md\` exactly: \`kit.ps1 status\`, one CHANGELOG Unreleased line per pending change, tidy, then \`powershell -NoProfile -ExecutionPolicy Bypass -File "${KIT_SCRIPT}" ship -Message "<one-line summary>"\`.
3. On a failure, use the table in \`$HOME/.claude/skills/kit-sync/SKILL.md\`, then ship again. Never push the kit with plain \`git push\`.

Reply with the released version, the pushed commit hash and one line per change shipped, or say there was nothing to ship.`;

const UPDATE_PROMPT = `Update the Project ARES kit (rules, skills, agents, commands, hooks, tools) on this machine to the latest version on GitHub. Only pull: do not edit, commit or push anything in the kit.

1. If \`${KIT_SCRIPT}\` exists, run \`powershell -NoProfile -ExecutionPolicy Bypass -File "${KIT_SCRIPT}" sync\`. On a failure, use the table in \`$HOME/.claude/skills/kit-sync/SKILL.md\`, then sync again.
2. If it does not exist, install the kit: clone ${KIT_REPO} to \`$env:USERPROFILE\\Documents\\UEFNCLAW\` (pull instead if that folder is already a clone), then run its \`install.ps1\` with \`powershell -NoProfile -ExecutionPolicy Bypass -File\`. The repository is private: if git or \`gh\` reports no access, stop and tell me to run \`gh auth login\` with an account that has access. Never type a password or token.

Reply with the kit version before and after (\`kit.json\` in the clone) and the CHANGELOG headings between them. Hooks are live at once; new skills and rules load in the next session.`;

const nowIso = () => new Date().toISOString();

const KIT_ACTIONS = [
  {
    key: "push",
    label: "Push ARES kit",
    prompt: PUSH_PROMPT,
    icon: <CloudUploadIcon className="size-4" />,
  },
  {
    key: "update",
    label: "Update ARES kit",
    prompt: UPDATE_PROMPT,
    icon: <CloudDownloadIcon className="size-4" />,
  },
] as const;

/** Replaces the idle update button; the app update control still shows when an update needs action. */
export function AresKitActions() {
  const navigate = useNavigate();
  const { scratchEnvironmentId, openScratchProject } = useScratchProject();
  const handleNewThread = useNewThreadHandler();
  const serverSettings = useAtomValue(primaryServerSettingsAtom);
  const settings = useMergedSettings(serverSettings);
  const providers = useAtomValue(primaryServerProvidersAtom);
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const updateState = useDesktopUpdateState();
  const updateRun = useUpdateEverythingRun();
  const pendingRef = useRef(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const showUpdateControl =
    updateRun !== null ||
    updateState?.status === "downloading" ||
    (updateState !== null && resolveDesktopUpdateButtonAction(updateState) !== "none");

  const fail = (title: string, error: unknown) =>
    toastManager.add({
      type: "error",
      title,
      description: error instanceof Error ? error.message : String(error),
    });

  const run = async (action: (typeof KIT_ACTIONS)[number]) => {
    const environmentId = scratchEnvironmentId(null);
    if (environmentId === null) {
      toastManager.add({
        type: "error",
        title: `Could not start ${action.label}`,
        description: "No connected machine can start threads without a project.",
      });
      return;
    }
    const project = await openScratchProject(environmentId, `Could not start ${action.label}`);
    if (project === null) return;

    const projectSettings = resolveProjectSettings(settings, project.id, project).settings;
    const modelSelection =
      resolveDefaultProviderModelSelection(providers, projectSettings.defaultModelSelection) ??
      resolveProjectDefaultProviderModelSelection(providers, settings, project.id);
    // Without a usable default model, a filled-in draft lets the user pick one and send.
    if (modelSelection === null) {
      await handleNewThread(scopeProjectRef(project.environmentId, project.id), {
        prompt: action.prompt,
      }).catch((error: unknown) => fail(`Could not start ${action.label}`, error));
      return;
    }

    const threadId = newThreadId();
    const createdAt = nowIso();
    const runtimeMode = projectSettings.defaultRuntimeMode;
    const result = await startTurn({
      environmentId: project.environmentId,
      input: {
        threadId,
        message: { messageId: newMessageId(), role: "user", text: action.prompt, attachments: [] },
        modelSelection,
        runtimeMode,
        interactionMode: "default",
        bootstrap: {
          createThread: {
            projectId: project.id,
            title: action.label,
            modelSelection,
            runtimeMode,
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt,
          },
        },
        createdAt,
      },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        fail(`Could not start ${action.label}`, squashAtomCommandFailure(result));
      }
      return;
    }
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(project.environmentId, threadId)),
    });
  };

  const start = (action: (typeof KIT_ACTIONS)[number]) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPendingKey(action.key);
    void run(action)
      .catch((error: unknown) => fail(`Could not start ${action.label}`, error))
      .finally(() => {
        pendingRef.current = false;
        setPendingKey(null);
      });
  };

  return (
    <>
      <SidebarMenuItem className="ml-auto shrink-0">
        <div className="flex items-center gap-0.5">
          {KIT_ACTIONS.map((action) => (
            <KitActionButton
              key={action.key}
              label={action.label}
              icon={action.icon}
              pending={pendingKey === action.key}
              disabled={pendingKey !== null}
              onClick={() => start(action)}
            />
          ))}
        </div>
      </SidebarMenuItem>
      {showUpdateControl ? <SidebarUpdatePill /> : null}
    </>
  );
}

function KitActionButton(props: {
  readonly label: string;
  readonly icon: ReactNode;
  readonly pending: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={props.label}
            aria-busy={props.pending || undefined}
            aria-disabled={props.disabled || undefined}
            onClick={props.disabled ? undefined : props.onClick}
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-full text-(--sidebar-icon-color) outline-hidden ring-ring transition-colors focus-visible:ring-2 focus-visible:ring-inset",
              props.disabled
                ? "cursor-not-allowed opacity-60"
                : "cursor-pointer hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
            )}
          >
            {props.icon}
          </button>
        }
      />
      <TooltipPopup side="top">{props.pending ? `${props.label}…` : props.label}</TooltipPopup>
    </Tooltip>
  );
}
