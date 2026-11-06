#!/usr/bin/env node
// Project Ares brand layer: every Ares edit to an upstream file comes from these rules, never
// by hand, so ares/sync.mjs can resolve brand conflicts by re-running them (see ARES.md).
// `node ares/rebrand.mjs` applies; `--check` exits 1 if anything is unbranded or stale.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const { execFileSync, spawnSync } = NodeChildProcess;
const { copyFileSync, existsSync, readFileSync, writeFileSync } = NodeFS;
const { dirname, join, resolve } = NodePath;
const { fileURLToPath } = NodeURL;

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const BRAND = {
  name: "Project Ares",
  appId: "com.lastmade.projectares",
  repository: "LastMadeDev/ProjectAresCode",
  userDataDir: "project-ares",
};

const RELEASES_URL = `https://github.com/${BRAND.repository}/releases`;

// User-visible text only. Agent-facing text, the `t3` CLI, package names, env vars and
// ~/.t3 stay upstream's: renaming them breaks compatibility and every merge.
const UI_TEXT_FILES = [
  /^apps\/web\/src\/.*\.(ts|tsx|css)$/,
  /^apps\/web\/index\.html$/,
  /^apps\/web\/public\/manifest\.webmanifest$/,
  /^apps\/desktop\/src\/.*\.(ts|tsx|mts|cts)$/,
  /^apps\/desktop\/scripts\/.*\.(mjs|cjs|js|ts)$/,
  /^apps\/desktop\/resources\/.*\.(nsh|xml|svg)$/,
  /^apps\/desktop\/package\.json$/,
  /^scripts\/build-desktop-artifact(\.test)?\.ts$/,
];

const PRODUCT_NAME_REPLACEMENTS = [
  // The stage suffix is dropped: the shipped app is just "Project Ares".
  [/T3 Code \(Beta\)/g, BRAND.name],
  // "(Alpha)" only names legacy installs and profiles that upstream migrates from.
  [/T3 Code(?! \(Alpha\))/g, BRAND.name],
];

// Targeted edits. `find` must match on a fresh upstream file, or `done` must already be
// present; otherwise the rule is reported stale so a human or agent updates it.
const TARGETED = [
  {
    file: "apps/web/src/branding.ts",
    edits: [
      {
        find: /DESKTOP_DOWNLOAD_URL = "https:\/\/t3\.codes\/download"/,
        replace: `DESKTOP_DOWNLOAD_URL = "${RELEASES_URL}/latest"`,
      },
    ],
  },
  {
    file: "apps/web/src/branding.logic.ts",
    edits: [
      {
        // The default stage is "Beta"; Ares shows no stage suffix for it.
        find: /if \(input\.stageLabel\.trim\(\)\.toLowerCase\(\) === "latest"\) \{/,
        replace: `if (["latest", "beta"].includes(input.stageLabel.trim().toLowerCase())) {`,
      },
    ],
  },
  {
    file: "apps/desktop/src/app/DesktopEnvironment.ts",
    edits: [
      {
        find: /displayName: `\$\{APP_BASE_NAME\} \(\$\{stageLabel\}\)`,/,
        replace:
          'displayName: stageLabel === "Beta" ? APP_BASE_NAME : `${APP_BASE_NAME} (${stageLabel})`,',
      },
    ],
  },
  {
    file: "apps/desktop/src/app/DesktopUserData.ts",
    edits: [
      // Own Electron profile, so Ares and T3 Code can be installed side by side.
      { find: /current: "t3code-dev"/, replace: `current: "${BRAND.userDataDir}-dev"` },
      { find: /current: "t3code-v2"/, replace: `current: "${BRAND.userDataDir}"` },
      // First launch on Windows copies the safeStorage key from T3 Code's current profile,
      // so anything T3 Code encrypted stays readable. The generic rename hit the dev name.
      { find: /legacy: "T3 Code \(Alpha\)"/, replace: 'legacy: "t3code-v2"' },
      { find: /legacy: "Project Ares \(Dev\)"/, replace: 'legacy: "T3 Code (Dev)"' },
    ],
  },
  {
    file: "apps/desktop/src/app/DesktopUserData.test.ts",
    edits: [
      {
        find: /"t3code-v2"|"T3 Code \(Alpha\)"/g,
        replace: (m) => (m === '"t3code-v2"' ? `"${BRAND.userDataDir}"` : '"t3code-v2"'),
        done: (text) => text.includes(`"${BRAND.userDataDir}"`),
      },
    ],
  },
  {
    file: "apps/web/src/components/desktopUpdate.logic.test.ts",
    edits: [
      {
        find: /"https:\/\/github\.com\/pingdotgg\/t3code\/releases/g,
        replace: `"https://github.com/${BRAND.repository}/releases`,
      },
    ],
  },
  {
    file: "scripts/build-desktop-artifact.test.ts",
    edits: [
      { find: /com\.t3tools\.t3code(?=["<.])/g, replace: BRAND.appId },
      {
        find: /com\\\.t3tools\\\.t3code(?=\\\.)/g,
        replace: BRAND.appId.replace(/\./g, "\\."),
        done: (text) => !/com\\\.t3tools\\\.t3code/.test(text),
      },
    ],
  },
  ...[
    "apps/desktop/src/app/DesktopEnvironment.ts",
    "apps/desktop/scripts/electron-launcher.mjs",
    "scripts/build-desktop-artifact.ts",
  ].map((file) => ({
    file,
    edits: [{ find: /com\.t3tools\.t3code(?=["`]|\.dev\b)/g, replace: BRAND.appId }],
  })),
  {
    file: "scripts/build-desktop-artifact.ts",
    edits: [
      {
        find: /artifactName: "T3-Code-\$\{version\}-\$\{arch\}\.\$\{ext\}"/,
        replace: 'artifactName: "Project-Ares-${version}-${arch}.${ext}"',
      },
    ],
  },
  {
    // The staged package name picks the Windows install folder; "t3code" would install Ares
    // over T3 Code. Author is the publisher shown in Windows' installed apps list.
    file: "scripts/build-desktop-artifact.ts",
    edits: [
      {
        find: /(const stagePackageJson: StagePackageJson = \{\n\s+name: )"t3code",/,
        replace: '$1"project-ares",',
        done: (text) =>
          /const stagePackageJson: StagePackageJson = \{\s+name: "project-ares",/.test(text),
      },
      {
        find: /homepage: "https:\/\/t3\.codes",(\s+)author: "T3 Tools",/,
        replace: `homepage: "https://github.com/${BRAND.repository}",$1author: "LastMadeDev",`,
        done: (text) => text.includes('author: "LastMadeDev",'),
      },
    ],
  },
  {
    // The `t3` shim marker is an ownership key, not branding: Ares must recognize (and
    // replace) a shim T3 Code wrote, and the reverse, or `t3` keeps the old app's path.
    file: "apps/desktop/src/app/DesktopCliShim.ts",
    edits: [
      {
        find: /"Written by Project Ares: runs the desktop app's bundled t3 CLI\."/,
        replace: `"Written by T3 Code: runs the desktop app's bundled t3 CLI."`,
      },
    ],
  },
  {
    file: "apps/desktop/src/app/DesktopStartupRecovery.ts",
    edits: [
      {
        find: /RELEASES_URL = "https:\/\/github\.com\/pingdotgg\/t3code\/releases"/,
        replace: `RELEASES_URL = "${RELEASES_URL}"`,
      },
    ],
  },
  {
    file: "apps/web/src/lib/bootError.ts",
    edits: [
      {
        find: /DOWNLOAD_URL = "https:\/\/t3\.codes\/download"/,
        replace: `DOWNLOAD_URL = "${RELEASES_URL}/latest"`,
      },
      {
        find: /ISSUE_URL = "https:\/\/github\.com\/pingdotgg\/t3code\/issues\/new"/,
        replace: `ISSUE_URL = "https://github.com/${BRAND.repository}/issues/new"`,
      },
    ],
  },
  {
    file: "apps/web/src/components/desktopUpdate.logic.ts",
    edits: [
      {
        find: /DEFAULT_DESKTOP_RELEASE_REPOSITORY = "pingdotgg\/t3code"/,
        replace: `DEFAULT_DESKTOP_RELEASE_REPOSITORY = "${BRAND.repository}"`,
      },
    ],
  },
  {
    file: "apps/web/src/components/GitHubStarPrompt.tsx",
    edits: [
      { find: /REPOSITORY = "pingdotgg\/t3code"/, replace: `REPOSITORY = "${BRAND.repository}"` },
    ],
  },
  {
    file: "apps/web/src/components/GitHubStarPrompt.test.ts",
    optional: true,
    edits: [
      {
        find: /"https:\/\/github\.com\/pingdotgg\/t3code"/g,
        replace: `"https://github.com/${BRAND.repository}"`,
      },
    ],
  },
  // Wordmark: the "T3" glyph becomes the ARES helm + name, and the trailing "Code" goes.
  {
    file: "apps/web/src/components/sidebar/SidebarChrome.tsx",
    edits: [
      { find: /<T3Wordmark aria-label="T3"/, replace: `<T3Wordmark aria-label="${BRAND.name}"` },
      {
        find: /\n\s*Code\n(\s*<\/span>)/,
        replace: "\n$1",
        done: (text) => !/\n\s*Code\n\s*<\/span>/.test(text),
      },
    ],
  },
  {
    file: "apps/web/src/components/onboarding/WelcomeWizard.tsx",
    edits: [
      {
        find: /(<T3Wordmark[^\n]*\n\s*<span[^\n]*>)\n\s*Code\n(\s*<\/span>)/,
        replace: "$1\n$2",
        done: (text) => !/<T3Wordmark[^\n]*\n\s*<span[^\n]*>\n\s*Code\n/.test(text),
      },
    ],
  },
  {
    // Telemetry still goes to upstream's ingest, so the copy must not claim Ares collects it.
    file: "apps/web/src/components/onboarding/WelcomeWizard.tsx",
    edits: [
      {
        find: /"Project Ares collects anonymous usage data to help us improve it\."/,
        replace:
          '"Anonymous usage data goes to T3 Tools, the upstream team, to help improve the app."',
      },
    ],
  },
  {
    file: "apps/web/src/components/settings/SettingsPanels.tsx",
    edits: [
      {
        find: /including the anonymous usage data Project Ares collects\./,
        replace: "including the anonymous usage data the app sends to T3 Tools, the upstream team.",
      },
    ],
  },
  {
    file: "apps/web/src/components/ui/standalone-page.tsx",
    edits: [
      {
        find: /(<T3Wordmark[^\n]*\n\s*<span[^>]*>)Code<\/span>/,
        replace: "$1</span>",
        done: (text) => !/<T3Wordmark[^\n]*\n\s*<span[^>]*>Code<\/span>/.test(text),
      },
    ],
  },
  {
    file: "apps/web/public/manifest.webmanifest",
    edits: [{ find: /"#161616"/g, replace: '"#0B0D12"' }],
  },
  {
    // ARES is a built-in theme (the default palette constants below carry its colors), so the
    // whole palette system paints it, sidebar included, and users can still pick another.
    file: "packages/shared/src/themePalettes.ts",
    edits: [
      {
        // Reserved, not in BUILT_IN_THEME_IDS: that list also drives the mobile app's
        // generated theme files, and Ares ships no mobile build.
        find: /(export const RESERVED_THEME_IDS: ReadonlySet<string> = new Set\(\[\n)/,
        replace: '$1  "ares",\n',
        done: (text) =>
          /RESERVED_THEME_IDS: ReadonlySet<string> = new Set\(\[\n {2}"ares",/.test(text),
      },
      {
        find: /export const BUILT_IN_THEMES: ReadonlyArray<ThemeDefinition> = \[/,
        // Upstream's standard palette plus Ares overrides: new upstream roles are inherited.
        replace: () =>
          [
            "const ARES_DARK_THEME_COLORS: ThemeColors = {",
            "  ...T3_CODE_DARK_THEME_COLORS,",
            ...Object.entries(DARK_THEME).map(([key, value]) => `  ${key}: "${value}",`),
            "};",
            "",
            "const ARES_LIGHT_THEME_COLORS: ThemeColors = {",
            "  ...T3_CODE_LIGHT_THEME_COLORS,",
            ...Object.entries(LIGHT_THEME).map(([key, value]) => `  ${key}: "${value}",`),
            "};",
            "",
            "export const ARES_THEME: ThemeDefinition = {",
            '  id: "ares",',
            `  label: "${BRAND.name}",`,
            '  appearance: "dark",',
            "  colors: ARES_DARK_THEME_COLORS,",
            "  variants: { light: ARES_LIGHT_THEME_COLORS },",
            "  sidebarArtwork: true,",
            "};",
            "",
            "export const BUILT_IN_THEMES: ReadonlyArray<ThemeDefinition> = [",
            "  ARES_THEME,",
          ].join("\n"),
        done: (text) => text.includes("export const ARES_THEME"),
      },
    ],
  },
  {
    file: "apps/web/src/themePalette.ts",
    edits: [
      {
        find: /\nexport \{ EMBER_THEME,/,
        replace:
          '\nexport { ARES_THEME } from "@t3tools/shared/themePalettes";\nexport { EMBER_THEME,',
        done: (text) =>
          text.includes('export { ARES_THEME } from "@t3tools/shared/themePalettes";'),
      },
    ],
  },
  {
    file: "apps/web/src/components/settings/ThemeSettings.tsx",
    edits: [
      {
        find: /\n(\s+)T3_CHAT_THEME,\n(\s+)EMBER_THEME,/,
        replace: "\n$1ARES_THEME,\n$1T3_CHAT_THEME,\n$2EMBER_THEME,",
        done: (text) => /\n\s+ARES_THEME,\n\s+T3_CHAT_THEME,\n\s+EMBER_THEME,/.test(text),
      },
      {
        find: /(const MAINTAINER_THEMES: ReadonlyArray<ThemeDefinition> = \[\n)/,
        replace: "$1  ARES_THEME,\n",
        done: (text) =>
          text.includes("MAINTAINER_THEMES: ReadonlyArray<ThemeDefinition> = [\n  ARES_THEME,"),
      },
    ],
  },
  {
    // Upstream's standard black/blue look stays available under an honest name.
    file: "apps/web/src/components/settings/ThemePreviewCircles.tsx",
    edits: [
      {
        find: /(id: "default",\n\s+label: )"Project Ares",/,
        replace: '$1"Classic",',
        done: (text) => /id: "default",\n\s+label: "Classic",/.test(text),
      },
    ],
  },
  {
    // New installs and environments without a chosen theme adopt ARES once.
    file: "packages/contracts/src/settings.ts",
    edits: [
      {
        find: /(defaultTheme: DefaultThemePreference\.pipe\(Schema\.withDecodingDefault\(Effect\.succeed\()""\)\)\)/,
        replace: '$1"ares")))',
        done: (text) => text.includes('withDecodingDefault(Effect.succeed("ares"))'),
      },
    ],
  },
  {
    // Agents working in the fork read the Ares rules next to upstream's.
    file: "CLAUDE.md",
    edits: [
      {
        find: /^@AGENTS\.md\s*$/,
        replace: "@AGENTS.md\n@ARES.md\n",
        done: (text) => text.includes("@ARES.md"),
      },
    ],
  },
];

// Whole files Ares owns outright, copied from ares/overrides/<same path>.
const OVERRIDE_FILES = ["apps/web/src/components/T3Wordmark.tsx"];

// ARES theme palette (generated into packages/shared/src/themePalettes.ts as ARES_THEME).
// Roles not listed inherit upstream's standard palette, so new upstream roles just work.
// Solid fills that carry white text use #c9403b (4.9:1); brand #d94b46 is only 4.2:1.
const DARK_THEME = {
  canvas: "#0b0d12",
  chrome: "#0b0d12",
  toolbar: "#0b0d12",
  toolbarForeground: "#f4f5f7",
  toolbarBorder: "#1e232d",
  toolbarControl: "#171b24",
  toolbarControlForeground: "#f4f5f7",
  toolbarControlHover: "#1d222c",
  surface: "#12151c",
  surfaceRaised: "#171b24",
  surfaceOverlay: "#171b24",
  text: "#f4f5f7",
  textMuted: "#929caa",
  border: "#232833",
  input: "#2a303b",
  focus: "#f16a63",
  accent: "#c9403b",
  accentForeground: "#ffffff",
  secondary: "#171b24",
  secondaryForeground: "#f4f5f7",
  muted: "#171b24",
  mutedForeground: "#929caa",
  placeholder: "#6f7988",
  secondaryLabel: "#929caa",
  iconMuted: "#929caa",
  error: "#ff655f",
  errorForeground: "#ff8a85",
  errorSurface: "#2a1214",
  warning: "#f0b35b",
  warningForeground: "#f5c77e",
  warningSurface: "#2b2111",
  update: "#d94b46",
  updateForeground: "#f16a63",
  updateSurface: "#2a1517",
  accentSurface: "#1d222c",
  accentSurfaceForeground: "#f4f5f7",
  messageSurface: "#1a1e27",
  messageForeground: "#f4f5f7",
  messageAction: "#c9403b",
  messageActionForeground: "#ffffff",
  messageActionHover: "#d94b46",
  codeBackground: "#12151c",
  codeForeground: "#f4f5f7",
  sidebar: "#080a0e",
  sidebarForeground: "#f4f5f7",
  sidebarMutedForeground: "#929caa",
  sidebarControlSurface: "#12151c",
  sidebarRowHover: "#151922",
  sidebarRowActive: "#1d222c",
  sidebarRowSelected: "#171b24",
  sidebarBorder: "#171b24",
  terminalBackground: "#0b0d12",
  terminalForeground: "#f4f5f7",
  terminalCursor: "#f16a63",
  terminalSelection: "#3a2427",
  terminalScrollbar: "#242a35",
  terminalScrollbarHover: "#303642",
};

const LIGHT_THEME = {
  focus: "#c9403b",
  accent: "#c9403b",
  update: "#c9403b",
  updateForeground: "#c9403b",
  updateSurface: "#fbeaea",
  messageAction: "#c9403b",
  messageActionHover: "#d94b46",
  terminalCursor: "#c9403b",
};

// Sidebar artwork gradients (apps/web/src/index.css), retinted from blue to crimson.
// [variable, occurrence (0 = light/base, 1 = dark variant), value]
const STAGE_ART = [
  ["--stage-art-top", 0, "oklch(0.78 0.11 28)"],
  ["--stage-art-mid", 0, "oklch(0.64 0.18 26)"],
  ["--stage-art-bottom", 0, "oklch(0.45 0.16 25)"],
  ["--stage-art-highlight", 0, "oklch(0.95 0.035 30)"],
  ["--stage-art-secondary", 0, "oklch(0.79 0.12 30)"],
  ["--stage-art-tertiary", 0, "oklch(0.68 0.17 18)"],
  ["--stage-art-line", 0, "oklch(0.96 0.025 30)"],
  ["--stage-art-celeste-highlight", 0, "oklch(0.97 0.04 40)"],
  ["--stage-art-celeste-secondary", 0, "oklch(0.83 0.11 35)"],
  ["--stage-art-violet-highlight", 0, "oklch(0.9 0.05 15)"],
  ["--stage-art-grid-line", 0, "oklch(0.97 0.015 30)"],
  ["--stage-night-base-top", 0, "oklch(0.26 0.07 20)"],
  ["--stage-night-base-mid", 0, "oklch(0.21 0.045 22)"],
  ["--stage-night-base-bottom", 0, "oklch(0.17 0.02 260)"],
  ["--stage-night-highlight", 0, "oklch(0.68 0.17 25)"],
  ["--stage-night-secondary", 0, "oklch(0.58 0.17 22)"],
  ["--stage-night-tertiary", 0, "oklch(0.6 0.19 12)"],
  ["--stage-night-line", 0, "oklch(0.94 0.025 30)"],
  ["--stage-night-glow-highlight", 0, "oklch(0.55 0.17 25)"],
  ["--stage-night-glow-secondary", 0, "oklch(0.34 0.11 24)"],
  ["--stage-night-sparkle", 0, "oklch(0.88 0.055 30)"],
  ["--stage-art-top", 1, "oklch(0.6 0.16 26)"],
  ["--stage-art-mid", 1, "oklch(0.47 0.15 25)"],
  ["--stage-art-bottom", 1, "oklch(0.3 0.1 22)"],
];

// Icons: upstream path -> ares/assets/icons/<file>. Every channel gets the Ares icon.
const ICONS = (() => {
  const map = {};
  const variants = {
    dev: {
      full: "assets/dev/blueprint-ios-1024.png",
      mac: "assets/dev/blueprint-macos-1024.png",
      universal: "assets/dev/blueprint-universal-1024.png",
      ico: "assets/dev/blueprint-windows.ico",
      favIco: "assets/dev/blueprint-web-favicon.ico",
      fav16: "assets/dev/blueprint-web-favicon-16x16.png",
      fav32: "assets/dev/blueprint-web-favicon-32x32.png",
      touch: "assets/dev/blueprint-web-apple-touch-180.png",
    },
    prod: {
      full: "assets/prod/black-ios-1024.png",
      mac: "assets/prod/black-macos-1024.png",
      universal: "assets/prod/black-universal-1024.png",
      ico: "assets/prod/t3-black-windows.ico",
      favIco: "assets/prod/t3-black-web-favicon.ico",
      fav16: "assets/prod/t3-black-web-favicon-16x16.png",
      fav32: "assets/prod/t3-black-web-favicon-32x32.png",
      touch: "assets/prod/t3-black-web-apple-touch-180.png",
    },
    nightly: {
      full: "assets/nightly/nightly-ios-1024.png",
      mac: "assets/nightly/nightly-macos-1024.png",
      universal: "assets/nightly/nightly-universal-1024.png",
      ico: "assets/nightly/nightly-windows.ico",
      favIco: "assets/nightly/nightly-web-favicon.ico",
      fav16: "assets/nightly/nightly-web-favicon-16x16.png",
      fav32: "assets/nightly/nightly-web-favicon-32x32.png",
      touch: "assets/nightly/nightly-web-apple-touch-180.png",
    },
  };
  for (const v of Object.values(variants)) {
    map[v.full] = "icon-full-1024.png";
    map[v.mac] = "icon-rounded-1024.png";
    map[v.universal] = "icon-rounded-1024.png";
    map[v.ico] = "app.ico";
    map[v.favIco] = "favicon.ico";
    map[v.fav16] = "favicon-16.png";
    map[v.fav32] = "favicon-32.png";
    map[v.touch] = "apple-touch-180.png";
  }
  map["apps/web/public/favicon.ico"] = "favicon.ico";
  map["apps/web/public/favicon-16x16.png"] = "favicon-16.png";
  map["apps/web/public/favicon-32x32.png"] = "favicon-32.png";
  map["apps/web/public/apple-touch-icon.png"] = "apple-touch-180.png";
  return map;
})();

export const ASSET_TARGETS = new Set([...Object.keys(ICONS), ...OVERRIDE_FILES]);

/** Text with formatting noise removed, for "is this already applied" and sync comparisons. */
export function squash(text) {
  return text
    .replace(/\{\s*(["'])\s*\1\s*\}/g, " ")
    .replace(/,(\s*[)\]}>])/g, "$1")
    .replace(/[()]/g, "")
    .replace(/\s+/g, "")
    .replace(/,$/, "");
}

/**
 * Format files with the repo formatter so generated lines match upstream style (the brand
 * makes some lines longer). Batched: Windows caps command lines at ~32k characters.
 */
export function formatFiles(files) {
  const formattable = files.filter((f) =>
    /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|json|css|md|html)$/.test(f),
  );
  for (let i = 0; i < formattable.length; i += 30) {
    const batch = formattable.slice(i, i + 30);
    const result = spawnSync("vp", ["fmt", "--no-error-on-unmatched-pattern", ...batch], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "ignore", "pipe"],
    });
    if (result.error || result.status !== 0) {
      console.warn(
        "warning: could not run `vp fmt`; install dependencies (`vp i`) and run `node ares/rebrand.mjs` again.",
      );
      return false;
    }
  }
  return true;
}

function setCssVar(content, name, occurrence, value, stale) {
  const re = new RegExp(`(${name.replace(/[-]/g, "\\-")}:\\s*)([^;]+);`, "g");
  let seen = -1;
  let hit = false;
  const out = content.replace(re, (all, prefix) => {
    seen += 1;
    if (seen !== occurrence) return all;
    hit = true;
    return `${prefix}${value};`;
  });
  if (!hit) stale.push(`index.css: ${name} #${occurrence} not found`);
  return out;
}

/** Apply every text rule that targets `file` to `content`. Pure: used by sync on blobs. */
export function rebrandText(file, content, stale = []) {
  const crlf = content.includes("\r\n");
  let text = crlf ? content.replace(/\r\n/g, "\n") : content;

  if (UI_TEXT_FILES.some((re) => re.test(file))) {
    for (const [re, to] of PRODUCT_NAME_REPLACEMENTS) text = text.replace(re, to);
  }

  for (const rule of TARGETED.filter((r) => r.file === file)) {
    for (const edit of rule.edits) {
      if (edit.done?.(text)) continue;
      const before = text;
      text = text.replace(edit.find, edit.replace);
      const changed = text !== before;
      const alreadyDone = edit.done
        ? edit.done(text)
        : typeof edit.replace === "string" && squash(text).includes(squash(edit.replace));
      if (!changed && !alreadyDone && !rule.optional) {
        stale.push(`${file}: ${edit.find}`);
      }
    }
  }

  if (file === "apps/web/src/index.css") {
    for (const [name, occurrence, value] of STAGE_ART)
      text = setCssVar(text, name, occurrence, value, stale);
  }

  return crlf ? text.replace(/\n/g, "\r\n") : text;
}

/** Files the text rules can touch (tracked files only). */
export function textRuleFiles(allFiles) {
  const targeted = new Set(TARGETED.map((r) => r.file));
  targeted.add("packages/shared/src/themePalettes.ts");
  targeted.add("apps/web/src/index.css");
  return allFiles.filter((f) => targeted.has(f) || UI_TEXT_FILES.some((re) => re.test(f)));
}

/** Expected bytes for an Ares-owned asset or override file. */
export function assetSource(file) {
  if (ICONS[file]) return join(REPO_ROOT, "ares/assets/icons", ICONS[file]);
  if (OVERRIDE_FILES.includes(file)) return join(REPO_ROOT, "ares/overrides", file);
  return null;
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  })
    .split("\0")
    .filter(Boolean);
}

export function run({ check }) {
  const files = trackedFiles();
  const stale = [];
  const changed = [];

  for (const file of textRuleFiles(files)) {
    const abs = join(REPO_ROOT, file);
    if (!existsSync(abs)) continue;
    const before = readFileSync(abs, "utf8");
    const after = rebrandText(file, before, stale);
    if (after !== before) {
      changed.push(file);
      if (!check) writeFileSync(abs, after);
    }
  }

  for (const file of ASSET_TARGETS) {
    const src = assetSource(file);
    const abs = join(REPO_ROOT, file);
    if (!existsSync(src)) {
      stale.push(`missing Ares source for ${file}`);
      continue;
    }
    const same = existsSync(abs) && readFileSync(abs).equals(readFileSync(src));
    if (!same) {
      changed.push(file);
      if (!check) copyFileSync(src, abs);
    }
  }

  if (!check && changed.length) formatFiles(changed);
  return { changed, stale };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const { changed, stale } = run({ check });
  for (const s of stale) console.error(`stale rule: ${s}`);
  if (check) {
    for (const f of changed) console.error(`unbranded: ${f}`);
    console.log(
      changed.length || stale.length ? "Ares brand check FAILED." : "Ares brand check passed.",
    );
    process.exit(changed.length || stale.length ? 1 : 0);
  }
  console.log(`Rebranded ${changed.length} file(s).`);
  if (stale.length) process.exit(1);
}
