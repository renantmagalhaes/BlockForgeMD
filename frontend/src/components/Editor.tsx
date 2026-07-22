import React, {
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  useCallback
} from "react";
import { createPortal } from "react-dom";
import {
  alertDialog,
  confirmDialog,
  promptDialog
} from "../lib/dialog";
import { useIsMobile } from "../lib/useIsMobile";
import EmojiPicker, {
  Theme
} from "emoji-picker-react";
import {
  useEditor,
  EditorContent,
  NodeViewWrapper,
  NodeViewContent,
  ReactNodeViewRenderer,
  isNodeSelection
} from "@tiptap/react";
import {
  Node,
  Extension,
  InputRule,
  mergeAttributes
} from "@tiptap/core";
import {
  Plugin,
  PluginKey,
  TextSelection
} from "@tiptap/pm/state";
import UnderlineExtension from "@tiptap/extension-underline";
import { DragHandle } from "@tiptap/extension-drag-handle";
import { Excalidraw } from "@excalidraw/excalidraw";
import StarterKit from "@tiptap/starter-kit";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import {
  all,
  createLowlight
} from "lowlight";

const lowlight = createLowlight(all);
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { ImageEditorModal } from "./ImageEditorModal";
import { Slideshow } from "./Slideshow";
import { markdownToEditorHtml } from "../lib/markdownToHtml";
import { mindmapEmbedTheme } from "../lib/mindmapEmbedTheme";
import { splitFrontMatter } from "../lib/frontMatter";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCellBase from "@tiptap/extension-table-cell";

const CELL_COLORS = [
  { label: "None", value: "" },
  {
    label: "Slate",
    value: "rgba(100,116,139,0.18)"
  },
  {
    label: "Red",
    value: "rgba(239,68,68,0.18)"
  },
  {
    label: "Orange",
    value: "rgba(249,115,22,0.18)"
  },
  {
    label: "Amber",
    value: "rgba(245,158,11,0.18)"
  },
  {
    label: "Green",
    value: "rgba(34,197,94,0.18)"
  },
  {
    label: "Teal",
    value: "rgba(20,184,166,0.18)"
  },
  {
    label: "Blue",
    value: "rgba(59,130,246,0.18)"
  },
  {
    label: "Violet",
    value: "rgba(139,92,246,0.18)"
  },
  {
    label: "Pink",
    value: "rgba(236,72,153,0.18)"
  }
];

// The saved .md file still carries `# Title` as the first body line (kept
// for portability — plain Markdown viewers/GitHub/Obsidian render it as the
// page heading, since YAML frontmatter isn't shown as a title by any of
// them). But the page title itself is no longer editable *as* that line:
// it's driven by the Title page attribute and rendered as a separate
// element above the editor. This strips that leading H1 out of what
// actually gets loaded into ProseMirror, so it can never be selected,
// edited, or accidentally retitled via the document body — see the H1
// re-add in executeAutoSave for the other half of this.
const stripLeadingTitleH1 = (
  markdown: string
): string => {
  const trimmed = markdown.replace(/^\s+/, "");
  const match = trimmed.match(/^# [^\n]*\n?/);
  if (!match) return markdown;
  return trimmed.slice(match[0].length).replace(/^\n+/, "");
};

const TableCell = TableCellBase.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        renderHTML: (attrs) =>
          attrs.backgroundColor
            ? {
                style: `background-color: ${attrs.backgroundColor};`
              }
            : {},
        parseHTML: (el) => {
          const style =
            el.getAttribute("style") ||
            "";
          const m = style.match(
            /background-color:\s*([^;]+)/
          );
          return m ? m[1].trim() : null;
        }
      }
    };
  }
});
import TableHeaderBase from "@tiptap/extension-table-header";

const TableHeader =
  TableHeaderBase.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        backgroundColor: {
          default: null,
          renderHTML: (attrs) =>
            attrs.backgroundColor
              ? {
                  style: `background-color: ${attrs.backgroundColor};`
                }
              : {},
          parseHTML: (el) => {
            const style =
              el.getAttribute(
                "style"
              ) || "";
            const m = style.match(
              /background-color:\s*([^;]+)/
            );
            return m
              ? m[1].trim()
              : null;
          }
        }
      };
    }
  });
import Placeholder from "@tiptap/extension-placeholder";
import Mathematics from "@tiptap/extension-mathematics";
import "katex/dist/katex.min.css";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Details, {
  DetailsSummary,
  DetailsContent
} from "@tiptap/extension-details";
import Typography from "@tiptap/extension-typography";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import TurndownService from "turndown";
import MindElixir from "mind-elixir";
import "mind-elixir/style.css";
import {
  Bold,
  Italic,
  Strikethrough,
  Underline as UnderlineIcon,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code2,
  FilePlus,
  CheckSquare,
  BookOpen,
  Palette,
  ChevronDown,
  Undo,
  Redo,
  Save,
  Loader2,
  Grid,
  Info,
  History,
  RotateCcw,
  X,
  Calendar,
  User,
  Tag,
  AlertCircle,
  Hash,
  Activity,
  Plus,
  FileText,
  LayoutGrid,
  Brush,
  Maximize2,
  AlignLeft,
  AlignCenter,
  Lock,
  BookMarked,
  MonitorPlay,
  Link2,
  Copy,
  Check,
  Download,
  Brain,
  Paperclip,
  ExternalLink,
  Trash2,
  ImageIcon,
  Sigma,
  Columns2,
  Link as LinkIcon,
  Clock,
  ArrowUp,
  ArrowDown,
  ChevronRight,
  ChevronLeft,
  Type,
  Repeat2,
  Presentation,
  AlertTriangle,
  Bug,
  Zap,
  HelpCircle,
  XCircle,
  CheckCircle2,
  Flame,
  ListTodo,
  GripVertical,
  GripHorizontal,
  ArrowLeft,
  ArrowRight
} from "lucide-react";

// Configure Turndown for clean Markdown serialization
const turndownService =
  new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bullet: "-",
    codeBlockStyle: "fenced"
  } as any);

// Custom rule for task lists in Turndown
turndownService.addRule(
  "taskListItems",
  {
    filter: (node) => {
      return (
        node.nodeName === "LI" &&
        (node.getAttribute(
          "data-type"
        ) === "taskItem" ||
          node.parentElement?.getAttribute(
            "data-type"
          ) === "taskList")
      );
    },
    replacement: (content, node) => {
      const input = node.querySelector(
        'input[type="checkbox"]'
      ) as HTMLInputElement | null;
      const checked = input
        ? input.checked
        : node.getAttribute(
            "data-checked"
          ) === "true";
      const status = checked
        ? "[x]"
        : "[ ]";
      // content is this item's own text plus, for a parent task, the
      // already-converted markdown of any nested sub-task-list (since
      // Turndown processes children first, bottom-up). Nested sibling
      // <li>s recursively hit this same rule, so indenting every
      // continuation line here by one level, at each ancestor in turn,
      // naturally compounds into the right cumulative indent per depth —
      // without that, every level collapses back to column 0, which is
      // what made nesting silently vanish on save (and thus on reload).
      const indented = content
        .trim()
        .split("\n")
        .map((line, i) =>
          i === 0 || !line
            ? line
            : `  ${line}`
        )
        .join("\n")
        // Turndown puts a blank line between this item's own text and a
        // nested sub-task-list as generic block spacing — but a blank line
        // before a nested list item makes the whole list "loose" per
        // CommonMark, which re-materializes as a stray empty paragraph
        // inside the item next time this file is loaded. Task items should
        // stay tight.
        .replace(/\n\n(\s*- \[)/g, "\n$1");
      return `- ${status} ${indented}\n`;
    }
  }
);

// Custom rule for Tables in Turndown
turndownService.addRule("tables", {
  filter: [
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td"
  ],
  replacement: (content, node) => {
    const name =
      node.nodeName.toLowerCase();
    if (
      name === "td" ||
      name === "th"
    ) {
      // A cell with more than one paragraph (Enter pressed inside it) or an
      // explicit hard break both come through here as a raw \n from
      // Turndown's own paragraph/br rules — but a GFM pipe-table row must be
      // exactly one physical line, so an unescaped newline here splits the
      // row across lines and corrupts the table on the next load. <br> is
      // the standard portable escape: marked's table parser keeps the row
      // intact, and the HTML it emits for the cell parses back into a
      // hardBreak node in the same paragraph, preserving the visual line break.
      const cellContent = content
        .trim()
        .replace(/\n+/g, "<br>");
      return ` ${cellContent} |`;
    }
    if (name === "tr") {
      const isHeader =
        node.parentElement?.nodeName.toLowerCase() ===
          "thead" ||
        node.querySelector("th");
      let suffix = "\n";
      if (isHeader) {
        const cellsCount =
          node.querySelectorAll(
            "td, th"
          ).length;
        const delimiter = `|${" --- |".repeat(cellsCount)}\n`;
        suffix = `\n${delimiter}`;
      }
      return `|${content}${suffix}`;
    }
    if (name === "table") {
      return `\n${content}\n`;
    }
    return content;
  }
});

// Custom rule for iframes in Turndown
turndownService.addRule("iframe", {
  filter: (node) =>
    node.nodeName.toLowerCase() ===
    "iframe",
  replacement: (_content, node) => {
    const src =
      (
        node as HTMLElement
      ).getAttribute("src") || "";
    const width =
      (
        node as HTMLElement
      ).getAttribute("width") || "100%";
    const height =
      (
        node as HTMLElement
      ).getAttribute("height") ||
      "450px";
    const frameborder =
      (
        node as HTMLElement
      ).getAttribute("frameborder") ||
      "0";
    const allowfullscreen =
      (
        node as HTMLElement
      ).getAttribute(
        "allowfullscreen"
      ) || "true";
    return `\n<iframe src="${src}" width="${width}" height="${height}" frameborder="${frameborder}" allowfullscreen="${allowfullscreen}"></iframe>\n`;
  }
});

// Custom rule for draw.io embeds in Turndown
turndownService.addRule("drawio", {
  filter: (node) =>
    node.nodeName.toLowerCase() ===
    "drawio",
  replacement: (_content, node) => {
    const path =
      (
        node as HTMLElement
      ).getAttribute("path") || "";
    return `\n<drawio path="${path}">drawio-canvas</drawio>\n`;
  }
});

// Custom rule for excalidraw embeds in Turndown
turndownService.addRule("excalidraw", {
  filter: (node) =>
    node.nodeName.toLowerCase() ===
    "excalidraw",
  replacement: (_content, node) => {
    const path =
      (
        node as HTMLElement
      ).getAttribute("path") || "";
    return `\n<excalidraw path="${path}">excalidraw-canvas</excalidraw>\n`;
  }
});

// Custom rule for mindmap embeds in Turndown
turndownService.addRule("mindmap", {
  filter: (node) =>
    node.nodeName.toLowerCase() ===
    "mindmap",
  replacement: (_content, node) => {
    const path =
      (
        node as HTMLElement
      ).getAttribute("path") || "";
    return `\n<mindmap path="${path}">mindmap-embed</mindmap>\n`;
  }
});

// Custom rule for bookmark embeds in Turndown
turndownService.addRule("bookmark", {
  filter: (node) =>
    node.nodeName.toLowerCase() ===
    "bookmark",
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const url = (
      el.getAttribute("url") || ""
    ).replace(/"/g, "&quot;");
    const title = (
      el.getAttribute("title") || ""
    ).replace(/"/g, "&quot;");
    const description = (
      el.getAttribute("description") ||
      ""
    ).replace(/"/g, "&quot;");
    const image = (
      el.getAttribute("image") || ""
    ).replace(/"/g, "&quot;");
    const favicon = (
      el.getAttribute("favicon") || ""
    ).replace(/"/g, "&quot;");
    // HTML serializers lowercase attribute names, so accept sitename (lowercase) or siteName
    const siteName = (
      el.getAttribute("sitename") ||
      el.getAttribute("siteName") ||
      ""
    ).replace(/"/g, "&quot;");
    return `\n<bookmark url="${url}" title="${title}" description="${description}" image="${image}" favicon="${favicon}" siteName="${siteName}"></bookmark>\n`;
  }
});

// Markdown has no underline syntax; preserve as raw HTML so the round-trip is lossless.
turndownService.addRule("underline", {
  filter: ["u"],
  replacement: (content) =>
    `<u>${content}</u>`
});

turndownService.addRule("tocBlock", {
  filter: (node) =>
    node.nodeName.toLowerCase() ===
    "toc-block",
  replacement: () =>
    "\n<toc-block></toc-block>\n"
});

// Custom rule for callout nodes in Turndown
turndownService.addRule("callout", {
  filter: (node) =>
    node.nodeName.toLowerCase() ===
      "div" &&
    (node as HTMLElement).getAttribute(
      "data-callout"
    ) === "true",
  replacement: (content, node) => {
    const el = node as HTMLElement;
    const emoji =
      el.getAttribute(
        "data-callout-emoji"
      ) || DEFAULT_CALLOUT_ICON_KEY;
    const label =
      el.getAttribute(
        "data-callout-label"
      ) || "Note";
    const color =
      el.getAttribute(
        "data-callout-color"
      ) || "#6366f1";
    return `\n<callout emoji="${emoji}" label="${label}" color="${color}">\n${content}\n</callout>\n`;
  }
});

// Serialize text color spans → <font color="...">
turndownService.addRule("textColor", {
  filter: (node) =>
    node.nodeName === "SPAN" &&
    !!(node as HTMLElement).style
      ?.color,
  replacement: (content, node) => {
    const color = (node as HTMLElement)
      .style.color;
    return `<font color="${color}">${content}</font>`;
  }
});

// Serialize highlight marks → <mark style="background: ...">
turndownService.addRule("highlight", {
  filter: "mark",
  replacement: (content, node) => {
    const bg = (node as HTMLElement)
      .style.backgroundColor;
    if (!bg) return content;
    return `<mark style="background: ${bg};">${content}</mark>`;
  }
});

turndownService.addRule("mathDisplay", {
  filter: (node) =>
    node.nodeName === "DIV" &&
    (
      node as HTMLElement
    ).classList.contains(
      "math-display"
    ),
  replacement: (_content, node) => {
    const latex =
      (
        node as HTMLElement
      ).getAttribute("data-latex") ||
      node.textContent ||
      "";
    return `\n\n$${latex}$\n\n`;
  }
});

turndownService.addRule("mathInline", {
  filter: (node) =>
    node.nodeName === "SPAN" &&
    (
      node as HTMLElement
    ).classList.contains("math-inline"),
  replacement: (_content, node) => {
    const latex =
      (
        node as HTMLElement
      ).getAttribute("data-latex") ||
      node.textContent ||
      "";
    return `$${latex}$`;
  }
});

// Columns: serialize as raw HTML so marked.js passes them through on reload
// columnItem must be registered before columnsWrapper so children are processed first
// Columns: use a custom fenced syntax so inner content is stored as markdown
// and re-rendered per-column on load (raw HTML approach loses inner markdown)
turndownService.addRule("columnItem", {
  filter: (node) =>
    node.nodeName === "DIV" &&
    (node as HTMLElement).hasAttribute(
      "data-column"
    ),
  replacement: (content) =>
    `:::col\n${content.trim()}\n`
});

turndownService.addRule(
  "columnsWrapper",
  {
    filter: (node) =>
      node.nodeName === "DIV" &&
      (
        node as HTMLElement
      ).hasAttribute("data-columns"),
    replacement: (content) =>
      `\n\n:::columns\n${content}:::\n\n`
  }
);

// Toggle blocks: serialize using GitHub's <details><summary> convention so
// the markdown round-trips as plain text and reads sensibly outside the app.
// Summary/content are wrapped in unique marker strings because Turndown hands
// the wrapper rule one concatenated string with no way to tell them apart.
const DETAILS_SUMMARY_START = "@@details-summary-start@@";
const DETAILS_SUMMARY_END = "@@details-summary-end@@";
const DETAILS_CONTENT_START = "@@details-content-start@@";
const DETAILS_CONTENT_END = "@@details-content-end@@";

turndownService.addRule("detailsSummary", {
  filter: (node) => node.nodeName === "SUMMARY",
  replacement: (content) =>
    `${DETAILS_SUMMARY_START}${content.trim()}${DETAILS_SUMMARY_END}`
});

turndownService.addRule("detailsContent", {
  filter: (node) =>
    node.nodeName === "DIV" &&
    (node as HTMLElement).getAttribute(
      "data-type"
    ) === "detailsContent",
  replacement: (content) =>
    `${DETAILS_CONTENT_START}${content.trim()}${DETAILS_CONTENT_END}`
});

turndownService.addRule("details", {
  // editor.getHTML() serializes the details node via its schema's
  // renderHTML (a plain <details> tag), not the editable nodeView's
  // custom <div data-type="details"> markup — filter on the real tag.
  filter: (node) => node.nodeName === "DETAILS",
  replacement: (content) => {
    const extractBetween = (
      text: string,
      startTag: string,
      endTag: string
    ) => {
      const from = text.indexOf(startTag);
      const to = text.indexOf(endTag);
      if (from === -1 || to === -1) return null;
      return text
        .slice(from + startTag.length, to)
        .trim();
    };
    const summary =
      extractBetween(
        content,
        DETAILS_SUMMARY_START,
        DETAILS_SUMMARY_END
      ) || "Toggle";
    const body =
      extractBetween(
        content,
        DETAILS_CONTENT_START,
        DETAILS_CONTENT_END
      ) || "";
    return `\n\n<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>\n\n`;
  }
});

const TEXT_COLORS = [
  { label: "Default", value: null },
  { label: "White", value: "#ffffff" },
  { label: "Black", value: "#000000" },
  { label: "Red", value: "#ef4444" },
  { label: "Orange", value: "#f97316" },
  { label: "Amber", value: "#f59e0b" },
  { label: "Yellow", value: "#eab308" },
  { label: "Green", value: "#22c55e" },
  { label: "Teal", value: "#14b8a6" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Indigo", value: "#6366f1" },
  { label: "Purple", value: "#a78bfa" },
  { label: "Pink", value: "#f472b6" },
  { label: "Gray", value: "#94a3b8" }
];

const BG_COLORS = [
  { label: "None", value: null },
  {
    label: "White",
    value: "rgba(255,255,255,0.12)"
  },
  {
    label: "Black",
    value: "rgba(0,0,0,0.5)"
  },
  {
    label: "Red",
    value: "rgba(239,68,68,0.3)"
  },
  {
    label: "Orange",
    value: "rgba(249,115,22,0.3)"
  },
  {
    label: "Amber",
    value: "rgba(245,158,11,0.3)"
  },
  {
    label: "Yellow",
    value: "rgba(234,179,8,0.3)"
  },
  {
    label: "Green",
    value: "rgba(34,197,94,0.3)"
  },
  {
    label: "Teal",
    value: "rgba(20,184,166,0.3)"
  },
  {
    label: "Blue",
    value: "rgba(59,130,246,0.3)"
  },
  {
    label: "Indigo",
    value: "rgba(99,102,241,0.3)"
  },
  {
    label: "Purple",
    value: "rgba(167,139,250,0.3)"
  },
  {
    label: "Pink",
    value: "rgba(244,114,182,0.3)"
  },
  {
    label: "Gray",
    value: "rgba(148,163,184,0.2)"
  }
];

// Simple line icons for callouts (replaces the old emoji picker) — the
// `calloutEmoji` node attr/HTML attribute is kept for backwards compatibility
// with existing documents, but now stores one of these icon keys instead of
// an emoji character.
const CALLOUT_ICONS: Record<
  string,
  React.ComponentType<{
    size?: number;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    style?: React.CSSProperties;
  }>
> = {
  info: Info,
  todo: ListTodo,
  missing: XCircle,
  warning: AlertTriangle,
  tip: Flame,
  question: HelpCircle,
  bug: Bug,
  summary: FileText,
  danger: Zap,
  done: CheckCircle2
};
const DEFAULT_CALLOUT_ICON_KEY = "info";

// Callout color palette
const CALLOUT_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#22c55e",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#64748b",
  "#e2e8f0"
];

// Complete searchable emoji database
const EMOJI_LIST = [
  {
    char: "😀",
    name: "grinning smiley smile face"
  },
  {
    char: "😃",
    name: "smiley happy smile face"
  },
  {
    char: "😄",
    name: "smiley grin laugh face"
  },
  {
    char: "😁",
    name: "grin beam face"
  },
  {
    char: "😆",
    name: "laugh squint face"
  },
  {
    char: "😅",
    name: "sweat smile face"
  },
  {
    char: "😂",
    name: "joy tears laugh face"
  },
  {
    char: "🤣",
    name: "rofl funny laugh face"
  },
  {
    char: "😊",
    name: "blush smile happy face"
  },
  {
    char: "😇",
    name: "halo innocent face"
  },
  {
    char: "🙂",
    name: "slightly smiling face"
  },
  {
    char: "🙃",
    name: "upside down face"
  },
  { char: "😉", name: "wink face" },
  { char: "😌", name: "relieved face" },
  {
    char: "😍",
    name: "heart eyes love face"
  },
  {
    char: "🥰",
    name: "smiling face with hearts love face"
  },
  {
    char: "😘",
    name: "kissing heart love face"
  },
  {
    char: "😋",
    name: "yum delicious face"
  },
  {
    char: "😛",
    name: "stuck out tongue face"
  },
  {
    char: "😜",
    name: "wink tongue face"
  },
  {
    char: "🤪",
    name: "zany crazy face"
  },
  {
    char: "🤨",
    name: "raised eyebrow face"
  },
  { char: "🧐", name: "monocle face" },
  {
    char: "🤓",
    name: "nerd face glasses"
  },
  {
    char: "😎",
    name: "sunglasses cool face"
  },
  {
    char: "🥸",
    name: "disguised face"
  },
  {
    char: "🤩",
    name: "star struck eyes face"
  },
  {
    char: "🥳",
    name: "partying celebrate face"
  },
  { char: "😏", name: "smirk face" },
  { char: "😒", name: "unamused face" },
  {
    char: "😞",
    name: "disappointed sad face"
  },
  {
    char: "😔",
    name: "pensive sad face"
  },
  {
    char: "😟",
    name: "worried sad face"
  },
  { char: "😕", name: "confused face" },
  {
    char: "🙁",
    name: "slightly frown face"
  },
  {
    char: "☹️",
    name: "frown sad face"
  },
  {
    char: "😣",
    name: "persevere face"
  },
  {
    char: "😖",
    name: "confounded face"
  },
  {
    char: "😫",
    name: "tired weary face"
  },
  {
    char: "😩",
    name: "weary tired face"
  },
  {
    char: "🥺",
    name: "pleading begging face"
  },
  {
    char: "😢",
    name: "cry sad tears face"
  },
  {
    char: "😭",
    name: "sob cry sad tears face"
  },
  {
    char: "😤",
    name: "triumph steam angry face"
  },
  {
    char: "😠",
    name: "angry mad face"
  },
  {
    char: "😡",
    name: "rage angry mad face"
  },
  {
    char: "🤬",
    name: "cursing swear angry face"
  },
  {
    char: "🤯",
    name: "exploding head mindblown face"
  },
  {
    char: "😳",
    name: "flushed blushed face"
  },
  { char: "🥵", name: "hot red face" },
  {
    char: "🥶",
    name: "cold blue face"
  },
  {
    char: "😱",
    name: "scream fear scared face"
  },
  {
    char: "😨",
    name: "fearful scared face"
  },
  {
    char: "😰",
    name: "anxious blue sweat face"
  },
  {
    char: "😥",
    name: "sad relieved sweat face"
  },
  {
    char: "😓",
    name: "cold sweat face"
  },
  { char: "🤔", name: "thinking face" },
  {
    char: "🫣",
    name: "peeking eye face"
  },
  {
    char: "🤭",
    name: "hand over mouth face"
  },
  {
    char: "🫢",
    name: "open mouth face"
  },
  {
    char: "🤫",
    name: "shush quiet silent face"
  },
  { char: "🫠", name: "melting face" },
  {
    char: "🤥",
    name: "liar pinocchio face"
  },
  { char: "😶", name: "no mouth face" },
  {
    char: "😐",
    name: "neutral line face"
  },
  {
    char: "😑",
    name: "expressionless line face"
  },
  {
    char: "😬",
    name: "grimacing teeth face"
  },
  {
    char: "🙄",
    name: "rolling eyes face"
  },
  {
    char: "😴",
    name: "sleep sleepy tired face"
  },
  { char: "🤤", name: "drool face" },
  {
    char: "😪",
    name: "sleepy tear face"
  },
  {
    char: "😵",
    name: "dizzy dead face"
  },
  {
    char: "🤐",
    name: "zipper mouth silent face"
  },
  {
    char: "🥴",
    name: "woozy drunk face"
  },
  {
    char: "🤢",
    name: "nauseated green sick face"
  },
  {
    char: "🤮",
    name: "vomit puke sick face"
  },
  {
    char: "🤧",
    name: "sneeze cold sick face"
  },
  {
    char: "😷",
    name: "mask medical sick face"
  },
  {
    char: "🤒",
    name: "thermometer temperature sick face"
  },
  {
    char: "🤕",
    name: "bandage head injury sick face"
  },
  {
    char: "🤑",
    name: "money mouth dollar face"
  },
  {
    char: "🤠",
    name: "cowboy hat face"
  },
  {
    char: "😈",
    name: "devil horn purple happy face"
  },
  {
    char: "👿",
    name: "devil angry purple sad face"
  },
  {
    char: "👹",
    name: "ogre red monster demon"
  },
  {
    char: "👺",
    name: "goblin red nose demon"
  },
  {
    char: "💀",
    name: "skull bones dead skeleton"
  },
  {
    char: "👻",
    name: "ghost spooky halloween"
  },
  {
    char: "👽",
    name: "alien ufo space"
  },
  {
    char: "👾",
    name: "space invader retro game"
  },
  {
    char: "🤖",
    name: "robot machine tech"
  },
  {
    char: "💩",
    name: "poop pile brown"
  },
  {
    char: "🤡",
    name: "clown circus face"
  },
  {
    char: "🔥",
    name: "fire hot flame burn"
  },
  {
    char: "💡",
    name: "idea light bulb smart"
  },
  {
    char: "⚠️",
    name: "warning danger yellow triangle"
  },
  {
    char: "🚨",
    name: "danger siren red alert police emergency"
  },
  {
    char: "ℹ️",
    name: "info information blue circle"
  },
  {
    char: "✅",
    name: "check correct green yes done success ok"
  },
  {
    char: "💬",
    name: "quote speech bubble chat comment"
  },
  {
    char: "🐛",
    name: "bug insect worm caterpillar"
  },
  {
    char: "🎯",
    name: "bullseye target goal hit focus"
  },
  {
    char: "🎉",
    name: "party popper celebrate congratulations"
  },
  {
    char: "📌",
    name: "pushpin red map pin"
  },
  {
    char: "🔑",
    name: "key lock password security"
  },
  {
    char: "💎",
    name: "diamond gem jewel rich"
  },
  {
    char: "🚀",
    name: "rocket space launch start speed"
  },
  {
    char: "⭐",
    name: "star yellow gold favorite"
  },
  {
    char: "🌟",
    name: "glowing star shine"
  },
  {
    char: "✨",
    name: "sparkles shine clean magic"
  },
  {
    char: "⚡️",
    name: "lightning bolt electricity energy fast power"
  },
  { char: "☄️", name: "comet space" },
  {
    char: "💥",
    name: "collision explosion burst blast"
  },
  {
    char: "🌪️",
    name: "tornado wind weather"
  },
  {
    char: "🌈",
    name: "rainbow colorful weather"
  },
  {
    char: "👀",
    name: "eyes look see watch"
  },
  {
    char: "👍",
    name: "thumbs up positive like yes ok"
  },
  {
    char: "👎",
    name: "thumbs down negative dislike no"
  },
  {
    char: "❤️",
    name: "heart red love"
  },
  {
    char: "💖",
    name: "sparkling heart love"
  },
  {
    char: "💔",
    name: "broken heart sad love"
  },
  {
    char: "👏",
    name: "clap hands applause"
  },
  {
    char: "🙌",
    name: "hooray raise hands celebrate"
  },
  {
    char: "🙏",
    name: "please thank you pray hands"
  },
  {
    char: "💪",
    name: "muscle flex strong power"
  },
  {
    char: "✍️",
    name: "writing hand pen pencil signature"
  },
  {
    char: "📍",
    name: "location map pin red"
  },
  {
    char: "⏱️",
    name: "stopwatch timer time"
  },
  {
    char: "⏰",
    name: "alarm clock time"
  },
  {
    char: "📅",
    name: "calendar date schedule"
  },
  {
    char: "📁",
    name: "folder directory document"
  },
  {
    char: "📂",
    name: "open folder directory"
  },
  {
    char: "📄",
    name: "page document sheet paper"
  },
  {
    char: "📋",
    name: "clipboard document task checklist"
  },
  {
    char: "📎",
    name: "paperclip clip attach"
  },
  {
    char: "🔗",
    name: "link chain hyperlink connect url"
  },
  {
    char: "✏️",
    name: "pencil edit write"
  },
  {
    char: "📝",
    name: "note memo document write pen page"
  },
  {
    char: "💼",
    name: "briefcase work job business"
  },
  {
    char: "🔍",
    name: "search magnifying glass find inspect"
  },
  {
    char: "🔒",
    name: "lock secure password private closed"
  },
  {
    char: "🔓",
    name: "unlock open insecure public"
  },
  {
    char: "🏷️",
    name: "tag label ticket price"
  },
  {
    char: "🎨",
    name: "palette art paint creative design"
  },
  {
    char: "🛠️",
    name: "tools hammer wrench repair dev fix"
  },
  {
    char: "💻",
    name: "computer laptop code dev technology tech"
  },
  {
    char: "📱",
    name: "phone mobile cellphone device"
  },
  {
    char: "🐱",
    name: "cat kitten animal pet"
  },
  {
    char: "🐶",
    name: "dog puppy animal pet"
  },
  {
    char: "🦁",
    name: "lion animal wild cat"
  },
  {
    char: "🐼",
    name: "panda animal bear"
  },
  {
    char: "🥑",
    name: "avocado food healthy"
  },
  {
    char: "🍕",
    name: "pizza food junk slice cheese"
  },
  {
    char: "🍔",
    name: "hamburger food junk burger cheese"
  },
  {
    char: "☕",
    name: "coffee tea hot drink cup mug cafe"
  },
  {
    char: "🍺",
    name: "beer alcohol drink glass mug pub"
  },
  {
    char: "🍷",
    name: "wine alcohol drink glass"
  },
  {
    char: "🚗",
    name: "car vehicle automobile drive transport"
  },
  {
    char: "✈️",
    name: "airplane plane flight travel sky transport"
  },
  {
    char: "🌍",
    name: "earth globe world space travel"
  },
  {
    char: "☀️",
    name: "sun sunny summer hot weather"
  },
  {
    char: "🌧️",
    name: "rain rainy clouds weather"
  },
  {
    char: "❄️",
    name: "snowflake snow cold winter ice weather"
  }
];

const hexToRgba = (
  hex: string,
  alpha: number
) => {
  const r = parseInt(
    hex.slice(1, 3),
    16
  );
  const g = parseInt(
    hex.slice(3, 5),
    16
  );
  const b = parseInt(
    hex.slice(5, 7),
    16
  );
  return `rgba(${r},${g},${b},${alpha})`;
};

const CalloutComponent = (
  props: any
) => {
  const iconKey: string =
    props.node.attrs.calloutEmoji ||
    DEFAULT_CALLOUT_ICON_KEY;
  // Undefined if iconKey isn't one of our simple icons — e.g. a raw emoji
  // character picked via the "More…" fallback picker, which we render as
  // literal text instead.
  const CalloutIcon =
    CALLOUT_ICONS[iconKey];
  const label: string =
    props.node.attrs.calloutLabel ||
    "Note";
  const color: string =
    props.node.attrs.calloutColor ||
    "#6366f1";

  const [
    emojiPickerOpen,
    setEmojiPickerOpen
  ] = useState(false);
  const [
    fullEmojiPickerOpen,
    setFullEmojiPickerOpen
  ] = useState(false);
  const [
    colorPickerOpen,
    setColorPickerOpen
  ] = useState(false);
  const [
    editingLabel,
    setEditingLabel
  ] = useState(false);
  const [labelValue, setLabelValue] =
    useState(label);
  const [hexDraft, setHexDraft] =
    useState(color);
  const labelInputRef =
    useRef<HTMLInputElement>(null);

  // Reset the draft hex whenever the picker (re)opens, so it always starts
  // from the callout's current color rather than whatever was last typed.
  useEffect(() => {
    if (colorPickerOpen)
      setHexDraft(color);
  }, [colorPickerOpen, color]);

  const emojiPickerRef =
    useRef<HTMLDivElement>(null);
  const colorPickerRef =
    useRef<HTMLDivElement>(null);

  // Sync label from props
  React.useEffect(() => {
    setLabelValue(label);
  }, [label]);
  React.useEffect(() => {
    if (editingLabel)
      labelInputRef.current?.focus();
  }, [editingLabel]);

  // Handle click outside & escape key
  useEffect(() => {
    if (
      !emojiPickerOpen &&
      !fullEmojiPickerOpen &&
      !colorPickerOpen
    )
      return;

    const handleMouseDown = (
      e: MouseEvent
    ) => {
      // Use the path captured at dispatch time rather than
      // e.target.contains()/closest(): clicking "More…" swaps the icon grid
      // for the full emoji picker synchronously, so by the time this
      // listener runs, e.target (the "More…" button) is already detached
      // from the DOM with no ancestors left to check — making a live
      // .contains() check wrongly report "clicked outside" and immediately
      // close the picker that was just opened.
      const path = e
        .composedPath()
        .filter(
          (el): el is Element =>
            el instanceof Element
        );
      const matches = (sel: string) =>
        path.some((el) => el.matches(sel));

      if (
        (emojiPickerOpen ||
          fullEmojiPickerOpen) &&
        !matches(
          '[title="Change icon"]'
        ) &&
        !path.some(
          (el) => el === emojiPickerRef.current
        )
      ) {
        setEmojiPickerOpen(false);
        setFullEmojiPickerOpen(false);
      }
      if (
        colorPickerOpen &&
        !matches(
          '[title="Change color"]'
        ) &&
        !path.some(
          (el) => el === colorPickerRef.current
        )
      ) {
        // Clicking away confirms whatever color was last picked/typed in
        // the popup (matching how the ball/hex field themselves commit on
        // blur) instead of silently discarding it.
        if (
          /^#[0-9a-fA-F]{6}$/.test(
            hexDraft
          )
        ) {
          props.updateAttributes({
            calloutColor: hexDraft
          });
        }
        setColorPickerOpen(false);
      }
    };

    const handleKeyDown = (
      e: KeyboardEvent
    ) => {
      if (e.key === "Escape") {
        setEmojiPickerOpen(false);
        setFullEmojiPickerOpen(false);
        setColorPickerOpen(false);
      }
    };

    document.addEventListener(
      "mousedown",
      handleMouseDown
    );
    document.addEventListener(
      "keydown",
      handleKeyDown
    );
    return () => {
      document.removeEventListener(
        "mousedown",
        handleMouseDown
      );
      document.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  }, [
    emojiPickerOpen,
    fullEmojiPickerOpen,
    colorPickerOpen,
    hexDraft
  ]);

  // A simple vertical tint: darker/subtler at the top, brightening toward the
  // bottom — keyed off the callout's own accent color so every color/theme
  // combination still works.
  const bg = `linear-gradient(180deg, ${hexToRgba(color, 0.05)} 0%, ${hexToRgba(color, 0.24)} 100%)`;
  const textColor = color;

  const closeAll = () => {
    setEmojiPickerOpen(false);
    setColorPickerOpen(false);
  };

  return (
    <NodeViewWrapper
      data-callout="true"
      data-callout-emoji={iconKey}
      data-callout-label={label}
      data-callout-color={color}
      style={{
        border: `1px solid ${color}`,
        background: bg,
        borderRadius: "8px",
        padding: "12px 16px",
        margin: "12px 0",
        position: "relative"
      }}
      className="group"
    >
      {/* Header row */}
      <div
        contentEditable={false}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "8px",
          userSelect: "none",
          position: "relative"
        }}
      >
        {/* Icon picker trigger */}
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setColorPickerOpen(false);
            setFullEmojiPickerOpen(false);
            setEmojiPickerOpen(
              (p) => !p
            );
          }}
          style={{
            lineHeight: 1,
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "2px",
            borderRadius: "6px",
            transition:
              "background 0.15s",
            display: "flex",
            alignItems: "center"
          }}
          title="Change icon"
        >
          {CalloutIcon ? (
            // A solid color badge with a white glyph reads as "bright and
            // filled" for every icon shape — unlike setting fill=stroke=color
            // directly on the icon, which made icons with cutout-style inner
            // details (Info, XCircle, HelpCircle, CheckCircle2) render as
            // blank circles, since their inner lines matched the fill color.
            <div
              style={{
                width: "22px",
                height: "22px",
                borderRadius: "9999px",
                background: textColor,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0
              }}
            >
              <CalloutIcon
                size={13}
                stroke="#fff"
                strokeWidth={2.5}
              />
            </div>
          ) : (
            <span style={{ fontSize: "18px", lineHeight: 1 }}>
              {iconKey}
            </span>
          )}
        </button>

        {/* Editable label */}
        {editingLabel ? (
          <input
            ref={labelInputRef}
            value={labelValue}
            onChange={(e) =>
              setLabelValue(
                e.target.value
              )
            }
            onBlur={() => {
              props.updateAttributes({
                calloutLabel:
                  labelValue || "Note"
              });
              setEditingLabel(false);
            }}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" ||
                e.key === "Escape"
              ) {
                props.updateAttributes({
                  calloutLabel:
                    labelValue || "Note"
                });
                setEditingLabel(false);
              }
            }}
            style={{
              color: textColor,
              fontWeight: 700,
              fontSize: "12px",
              letterSpacing: "0.05em",
              textTransform:
                "uppercase",
              background: "transparent",
              border: `1px solid ${color}60`,
              borderRadius: "4px",
              padding: "1px 6px",
              outline: "none",
              width: "120px"
            }}
          />
        ) : (
          <span
            onMouseDown={(e) => {
              e.preventDefault();
              setEditingLabel(true);
              closeAll();
            }}
            style={{
              color: textColor,
              fontWeight: 700,
              fontSize: "12px",
              letterSpacing: "0.05em",
              textTransform:
                "uppercase",
              cursor: "text",
              borderBottom: `1px dashed ${color}50`,
              paddingBottom: "1px"
            }}
            title="Click to rename"
          >
            {label}
          </span>
        )}

        {/* Color picker trigger */}
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setEmojiPickerOpen(false);
            setColorPickerOpen(
              (p) => !p
            );
          }}
          style={{
            width: "14px",
            height: "14px",
            borderRadius: "50%",
            background: color,
            border: `2px solid ${color}80`,
            cursor: "pointer",
            flexShrink: 0,
            boxShadow:
              "0 0 0 1px rgba(0,0,0,0.3)"
          }}
          title="Change color"
        />

        {/* Icon picker dropdown — simple line icons instead of emoji */}
        {emojiPickerOpen && (
          <div
            ref={emojiPickerRef}
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              zIndex: 9999,
              background: "#161b22",
              border:
                "1px solid #30363d",
              borderRadius: "10px",
              padding: "10px",
              boxShadow:
                "0 8px 32px rgba(0,0,0,0.6)"
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(5, 1fr)",
                gap: "6px"
              }}
            >
              {Object.entries(
                CALLOUT_ICONS
              ).map(([key, Icon]) => (
                <button
                  key={key}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    props.updateAttributes(
                      {
                        calloutEmoji:
                          key
                      }
                    );
                    setEmojiPickerOpen(
                      false
                    );
                  }}
                  style={{
                    width: "28px",
                    height: "28px",
                    display: "flex",
                    alignItems:
                      "center",
                    justifyContent:
                      "center",
                    background:
                      key === iconKey
                        ? "rgba(255,255,255,0.1)"
                        : "transparent",
                    border:
                      key === iconKey
                        ? "1px solid #6366f1"
                        : "1px solid transparent",
                    borderRadius: "6px",
                    cursor: "pointer"
                  }}
                  title={key}
                >
                  <div
                    style={{
                      width: "20px",
                      height: "20px",
                      borderRadius: "9999px",
                      background: textColor,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0
                    }}
                  >
                    <Icon
                      size={12}
                      stroke="#fff"
                      strokeWidth={2.5}
                    />
                  </div>
                </button>
              ))}
            </div>

            <button
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setEmojiPickerOpen(false);
                setFullEmojiPickerOpen(true);
              }}
              style={{
                width: "100%",
                marginTop: "8px",
                padding: "5px 0",
                background: "none",
                border: "1px solid #30363d",
                borderRadius: "6px",
                color: "#94a3b8",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              More…
            </button>
          </div>
        )}

        {/* Full emoji picker — fallback for when the simple icon set isn't enough */}
        {fullEmojiPickerOpen && (
          <div
            ref={emojiPickerRef}
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              zIndex: 9999,
              boxShadow: "0 8px 32px rgba(0,0,0,0.6)"
            }}
          >
            <EmojiPicker
              theme={Theme.DARK}
              lazyLoadEmojis={true}
              onEmojiClick={(emojiData) => {
                props.updateAttributes({
                  calloutEmoji: emojiData.emoji
                });
                setFullEmojiPickerOpen(false);
              }}
            />
          </div>
        )}

        {/* Color picker dropdown */}
        {colorPickerOpen && (
          <div
            ref={colorPickerRef}
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              zIndex: 9999,
              background: "#161b22",
              border:
                "1px solid #30363d",
              borderRadius: "10px",
              padding: "10px",
              boxShadow:
                "0 8px 32px rgba(0,0,0,0.6)"
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(6, 1fr)",
                gap: "6px",
                marginBottom: "8px"
              }}
            >
              {CALLOUT_COLORS.map(
                (c) => (
                  <button
                    key={c}
                    onMouseDown={(
                      e
                    ) => {
                      e.preventDefault();
                      e.stopPropagation();
                      props.updateAttributes(
                        {
                          calloutColor:
                            c
                        }
                      );
                      setColorPickerOpen(
                        false
                      );
                    }}
                    style={{
                      width: "22px",
                      height: "22px",
                      borderRadius:
                        "50%",
                      background: c,
                      border:
                        c === color
                          ? "2px solid white"
                          : "2px solid transparent",
                      cursor: "pointer",
                      boxShadow:
                        "0 0 0 1px rgba(0,0,0,0.4)"
                    }}
                    title={c}
                  />
                )
              )}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px"
              }}
            >
              <input
                type="color"
                value={
                  /^#[0-9a-fA-F]{6}$/.test(
                    hexDraft
                  )
                    ? hexDraft
                    : color
                }
                // Fires continuously while dragging around the native picker —
                // only track it locally so we don't apply/close on the very
                // first intermediate color the user touches.
                onChange={(e) =>
                  setHexDraft(
                    e.target.value
                  )
                }
                onBlur={() => {
                  if (
                    /^#[0-9a-fA-F]{6}$/.test(
                      hexDraft
                    )
                  ) {
                    props.updateAttributes(
                      {
                        calloutColor:
                          hexDraft
                      }
                    );
                    setColorPickerOpen(
                      false
                    );
                  }
                }}
                title="Pick a custom color"
                className="bf-color-ball"
              />
              <input
                type="text"
                value={hexDraft}
                maxLength={7}
                onChange={(e) =>
                  setHexDraft(
                    e.target.value
                  )
                }
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    /^#[0-9a-fA-F]{6}$/.test(
                      hexDraft
                    )
                  ) {
                    props.updateAttributes(
                      {
                        calloutColor:
                          hexDraft
                      }
                    );
                    setColorPickerOpen(
                      false
                    );
                  }
                }}
                style={{
                  background: "#0d1117",
                  border:
                    "1px solid #30363d",
                  borderRadius: "6px",
                  padding: "3px 8px",
                  color: "#e2e8f0",
                  fontSize: "11px",
                  outline: "none",
                  width: "80px",
                  fontFamily:
                    "monospace"
                }}
                placeholder="#rrggbb"
              />
            </div>
          </div>
        )}
      </div>

      {/* Editable body content */}
      <NodeViewContent
        style={{
          color: "#cbd5e1",
          fontSize: "14px",
          lineHeight: "1.7"
        }}
      />
    </NodeViewWrapper>
  );
};

const CalloutNode = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      calloutEmoji: {
        default:
          DEFAULT_CALLOUT_ICON_KEY,
        parseHTML: (el) =>
          el.getAttribute(
            "data-callout-emoji"
          ) || DEFAULT_CALLOUT_ICON_KEY,
        renderHTML: (attrs) => ({
          "data-callout-emoji":
            attrs.calloutEmoji
        })
      },
      calloutLabel: {
        default: "Note",
        parseHTML: (el) =>
          el.getAttribute(
            "data-callout-label"
          ) || "Note",
        renderHTML: (attrs) => ({
          "data-callout-label":
            attrs.calloutLabel
        })
      },
      calloutColor: {
        default: "#6366f1",
        parseHTML: (el) =>
          el.getAttribute(
            "data-callout-color"
          ) || "#6366f1",
        renderHTML: (attrs) => ({
          "data-callout-color":
            attrs.calloutColor
        })
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-callout="true"]'
      },
      {
        tag: "callout",
        getAttrs: (el) => ({
          calloutEmoji:
            (
              el as HTMLElement
            ).getAttribute("emoji") ||
            DEFAULT_CALLOUT_ICON_KEY,
          calloutLabel:
            (
              el as HTMLElement
            ).getAttribute("label") ||
            "Note",
          calloutColor:
            (
              el as HTMLElement
            ).getAttribute("color") ||
            "#6366f1"
        })
      }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(
        { "data-callout": "true" },
        HTMLAttributes
      ),
      0
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(
      CalloutComponent
    );
  }
});

const IframeViewerComponent = (
  props: any
) => {
  const { src, width, height } =
    props.node.attrs;
  const containerRef =
    useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] =
    useState(false);

  // Some sites (Reddit among them) send headers that flatly refuse to be
  // framed — rather than show a blank/broken iframe, check first and fall
  // back to a server-rendered screenshot when framing is blocked.
  const [embedStatus, setEmbedStatus] =
    useState<
      "checking" | "ok" | "blocked"
    >("checking");
  useEffect(() => {
    setEmbedStatus("checking");
    if (!src) return;
    const API_BASE = import.meta.env.DEV
      ? "http://localhost:8080"
      : "";
    let cancelled = false;
    fetch(
      `${API_BASE}/api/embed-check?url=${encodeURIComponent(src)}`
    )
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setEmbedStatus(
          data.embeddable === false
            ? "blocked"
            : "ok"
        );
      })
      .catch(() => {
        // Inconclusive — fail open and let the iframe attempt happen normally.
        if (!cancelled)
          setEmbedStatus("ok");
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  // Screenshot capture itself can fail independently of the embed-check
  // (site-level bot detection, the headless browser timing out, etc.) — when
  // that happens, fall back further to just the site's favicon rather than a
  // broken image.
  const [
    screenshotFailed,
    setScreenshotFailed
  ] = useState(false);
  useEffect(() => {
    setScreenshotFailed(false);
  }, [src]);

  const srcHostname = (() => {
    try {
      return new URL(src).hostname;
    } catch {
      return src;
    }
  })();

  const handleMouseDown = (
    e: React.MouseEvent
  ) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (
      e: MouseEvent
    ) => {
      if (!containerRef.current) return;
      const rect =
        containerRef.current.getBoundingClientRect();

      const newWidth = Math.max(
        200,
        Math.min(
          e.clientX - rect.left,
          window.innerWidth -
            rect.left -
            40
        )
      );
      const newHeight = Math.max(
        150,
        e.clientY - rect.top
      );

      props.updateAttributes({
        width: `${newWidth}px`,
        height: `${newHeight}px`
      });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener(
      "mousemove",
      handleMouseMove
    );
    window.addEventListener(
      "mouseup",
      handleMouseUp
    );

    return () => {
      window.removeEventListener(
        "mousemove",
        handleMouseMove
      );
      window.removeEventListener(
        "mouseup",
        handleMouseUp
      );
    };
  }, [isResizing, props]);

  return (
    <NodeViewWrapper
      ref={containerRef}
      style={{
        width: width || "100%",
        height: height || "450px"
      }}
      className="iframe-embed my-4 border border-slate-800 rounded-xl overflow-hidden shadow-lg bg-[#0d1117] relative group flex flex-col"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-[#161b22]/50 select-none h-9 shrink-0">
        <div className="flex items-center space-x-2">
          <span className="text-violet-400">
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
              />
            </svg>
          </span>
          <span className="text-xs font-semibold text-slate-350 truncate">
            Embedded Web Frame: {src}
          </span>
        </div>
      </div>

      {/* Frame wrapper container */}
      <div className="relative w-full flex-1 min-w-[200px] min-h-[110px]">
        {isResizing && (
          <div className="absolute inset-0 z-10 bg-transparent" />
        )}

        {embedStatus === "checking" && (
          <div className="w-full h-full flex items-center justify-center text-slate-500 text-xs gap-2">
            <Loader2 className="animate-spin w-3.5 h-3.5" />
            <span>Checking embed…</span>
          </div>
        )}
        {embedStatus === "ok" && (
          <iframe
            src={src}
            className="w-full h-full border-none"
            title="Iframe Embed"
            allowFullScreen
          />
        )}
        {embedStatus === "blocked" &&
          !screenshotFailed && (
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              data-embed-screenshot="true"
              className="relative block w-full h-full bg-[#0d1117] group/screenshot"
              title="This site blocks embedding — showing a screenshot instead. Click to open the original."
            >
              <img
                src={`${
                  import.meta.env.DEV
                    ? "http://localhost:8080"
                    : ""
                }/api/screenshot?url=${encodeURIComponent(src)}`}
                alt={`Screenshot of ${src}`}
                className="w-full h-full object-cover object-top"
                onError={() =>
                  setScreenshotFailed(
                    true
                  )
                }
              />
              <span className="absolute bottom-2 right-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/70 group-hover/screenshot:bg-black/85 text-[11px] font-semibold text-slate-200 group-hover/screenshot:text-white transition backdrop-blur-sm">
                <ExternalLink size={12} />
                Open original
              </span>
            </a>
          )}
        {embedStatus === "blocked" &&
          screenshotFailed && (
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              data-embed-screenshot="true"
              className="flex flex-col items-center justify-center gap-3 w-full h-full bg-[#0d1117] hover:bg-[#12161e] transition"
              title="Open original"
            >
              <img
                src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(srcHostname)}&sz=64`}
                alt=""
                className="w-10 h-10 opacity-90"
              />
              <div className="text-center px-4">
                <div className="text-sm font-semibold text-slate-300">
                  {srcHostname}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Can't preview this
                  site
                </div>
              </div>
              <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#1f242c] border border-slate-700/80 text-[11px] font-semibold text-slate-300">
                <ExternalLink size={12} />
                Open original
              </span>
            </a>
          )}

        {/* Resize handle */}
        <div
          onMouseDown={handleMouseDown}
          className="absolute bottom-1 right-1 w-4 h-4 cursor-se-resize flex items-end justify-end p-0.5 z-20 hover:scale-110 active:scale-95 transition"
        >
          <svg
            className="w-3.5 h-3.5 text-slate-400 hover:text-violet-400"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 19H5m14-6H11m8-6h-5"
            />
          </svg>
        </div>
      </div>
    </NodeViewWrapper>
  );
};

const IframeNode = Node.create({
  name: "iframe",
  group: "block",
  selectable: true,
  draggable: true,
  atom: true,

  addAttributes() {
    return {
      src: {
        default: null
      },
      width: {
        default: "100%"
      },
      height: {
        default: "450px"
      },
      frameborder: {
        default: "0"
      },
      allowfullscreen: {
        default: "true"
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: "iframe"
      }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "iframe",
      mergeAttributes(HTMLAttributes)
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(
      IframeViewerComponent
    );
  }
});

const DrawioViewerComponent = (
  props: any
) => {
  const filePath =
    props.node.attrs.path;
  const [xml, setXml] = useState<
    string | null
  >(null);
  const iframeRef =
    useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!filePath) return;
    // Fetch the canvas file content to extract Draw.io XML
    fetch(
      `/api/file?path=${encodeURIComponent(filePath)}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (data && data.content) {
          const codeBlockMatch =
            data.content.match(
              /```xml\n([\s\S]*?)\n```/
            );
          if (
            codeBlockMatch &&
            codeBlockMatch[1]
          ) {
            setXml(
              codeBlockMatch[1].trim()
            );
          }
        }
      })
      .catch((err) =>
        console.error(
          "Failed to load embedded draw.io file",
          err
        )
      );
  }, [filePath]);

  useEffect(() => {
    if (!xml) return;

    const handleMessage = (
      e: MessageEvent
    ) => {
      if (
        e.origin !==
          "https://embed.diagrams.net" &&
        e.origin !==
          "https://app.diagrams.net" &&
        e.origin !==
          "https://viewer.diagrams.net"
      ) {
        return;
      }
      try {
        const data = JSON.parse(e.data);
        if (data.event === "init") {
          iframeRef.current?.contentWindow?.postMessage(
            JSON.stringify({
              action: "load",
              xml: xml
            }),
            "*"
          );
        }
      } catch (err) {
        // Ignore
      }
    };

    window.addEventListener(
      "message",
      handleMessage
    );
    return () => {
      window.removeEventListener(
        "message",
        handleMessage
      );
    };
  }, [xml]);

  return (
    <NodeViewWrapper className="drawio-embed my-4 border border-slate-800 rounded-xl overflow-hidden shadow-lg bg-[#0d1117] text-slate-200">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-[#161b22]/50">
        <div className="flex items-center space-x-2 select-none">
          <span className="text-violet-400">
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
              />
            </svg>
          </span>
          <span className="text-xs font-semibold text-slate-350 truncate">
            Embedded Draw.io Canvas:{" "}
            {filePath
              ? filePath
                  .split("/")
                  .pop()
              : "Untitled"}
          </span>
        </div>
        <a
          href={`/${filePath}`}
          onClick={(e) => {
            e.preventDefault();
            props.extension.options.onSelectFile?.(
              filePath
            );
          }}
          className="text-[10px] text-violet-400 hover:text-violet-300 font-bold underline transition cursor-pointer select-none"
        >
          Edit Canvas
        </a>
      </div>
      <div className="relative w-full h-[400px] bg-[#121212]">
        <iframe
          ref={iframeRef}
          src="https://viewer.diagrams.net/?embed=1&ui=dark&spin=1&proto=json"
          className="w-full h-full border-none"
          title="Draw.io Embedded Viewer"
        />
      </div>
    </NodeViewWrapper>
  );
};

const DrawioNode = Node.create({
  name: "drawio",
  group: "block",
  selectable: true,
  draggable: true,
  atom: true,

  addOptions() {
    return {
      onSelectFile: null
    };
  },

  addAttributes() {
    return {
      path: {
        default: null
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: "drawio"
      }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "drawio",
      mergeAttributes(HTMLAttributes),
      "drawio-canvas"
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(
      DrawioViewerComponent
    );
  }
});

const ExcalidrawViewerComponent = (
  props: any
) => {
  const filePath =
    props.node.attrs.path;
  const [elements, setElements] =
    useState<any[]>([]);
  const [appState, setAppState] =
    useState<any>({
      theme: "dark",
      viewBackgroundColor: "#121212"
    });
  const [isLoaded, setIsLoaded] =
    useState(false);
  const excalidrawRef =
    useRef<any>(null);

  useEffect(() => {
    if (!filePath) return;
    fetch(
      `/api/file?path=${encodeURIComponent(filePath)}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (data && data.content) {
          const codeBlockMatch =
            data.content.match(
              /```json\n([\s\S]*?)\n```/
            );
          if (
            codeBlockMatch &&
            codeBlockMatch[1]
          ) {
            const parsed = JSON.parse(
              codeBlockMatch[1]
            );
            if (
              parsed &&
              Array.isArray(
                parsed.elements
              )
            ) {
              setElements(
                parsed.elements
              );
              if (parsed.appState) {
                setAppState({
                  ...parsed.appState,
                  theme: "dark"
                });
              }
            }
          }
        }
        setIsLoaded(true);
      })
      .catch((err) =>
        console.error(
          "Failed to load embedded excalidraw file",
          err
        )
      );
  }, [filePath]);

  useEffect(() => {
    if (
      isLoaded &&
      elements.length > 0 &&
      excalidrawRef.current
    ) {
      const hasCustomScroll =
        appState.scrollX !==
          undefined &&
        appState.scrollX !== 0;
      const hasCustomZoom =
        appState.zoom &&
        appState.zoom.value !==
          undefined &&
        appState.zoom.value !== 1;

      if (
        !hasCustomScroll &&
        !hasCustomZoom
      ) {
        const timer = setTimeout(() => {
          excalidrawRef.current?.scrollToContent();
        }, 250);
        return () =>
          clearTimeout(timer);
      }
    }
  }, [isLoaded, elements, appState]);

  return (
    <NodeViewWrapper className="excalidraw-embed my-4 border border-slate-800 rounded-xl overflow-hidden shadow-lg bg-[#0d1117] text-slate-200">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-[#161b22]/50">
        <div className="flex items-center space-x-2 select-none">
          <span className="text-violet-400">
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
              />
            </svg>
          </span>
          <span className="text-xs font-semibold text-slate-350 truncate">
            Embedded Excalidraw Canvas:{" "}
            {filePath
              ? filePath
                  .split("/")
                  .pop()
              : "Untitled"}
          </span>
        </div>
        <a
          href={`/${filePath}`}
          onClick={(e) => {
            e.preventDefault();
            props.extension.options.onSelectFile?.(
              filePath
            );
          }}
          className="text-[10px] text-violet-400 hover:text-violet-300 font-bold underline transition cursor-pointer select-none"
        >
          Edit Canvas
        </a>
      </div>
      <div className="relative w-full h-[400px] bg-[#121212] flex items-center justify-center">
        {!isLoaded ? (
          <div className="text-xs text-slate-500 select-none">
            Loading Excalidraw viewer...
          </div>
        ) : (
          <Excalidraw
            excalidrawAPI={(
              api: any
            ) => {
              excalidrawRef.current =
                api;
            }}
            viewModeEnabled={true}
            initialData={{
              elements,
              appState: {
                ...appState,
                theme: "dark"
              }
            }}
            theme="dark"
          />
        )}
      </div>
    </NodeViewWrapper>
  );
};

const ExcalidrawNode = Node.create({
  name: "excalidraw",
  group: "block",
  selectable: true,
  draggable: true,
  atom: true,

  addOptions() {
    return {
      onSelectFile: null
    };
  },

  addAttributes() {
    return {
      path: {
        default: null
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: "excalidraw"
      }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "excalidraw",
      mergeAttributes(HTMLAttributes),
      "excalidraw-canvas"
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(
      ExcalidrawViewerComponent
    );
  }
});

const MINDMAP_EMBED_THEME =
  mindmapEmbedTheme;

const MindMapEmbedComponent = (
  props: any
) => {
  const filePath =
    props.node.attrs.path;
  const containerRef =
    useRef<HTMLDivElement>(null);
  const meRef = useRef<any>(null);
  const [mapTitle, setMapTitle] =
    useState<string>(
      filePath
        ? filePath
            .split("/")
            .pop()
            ?.replace(".mindmap.md", "")
        : "Mind Map"
    );
  const API_BASE = import.meta.env.DEV
    ? "http://localhost:8080"
    : "";

  useEffect(() => {
    if (
      !filePath ||
      !containerRef.current
    )
      return;
    let destroyed = false;

    fetch(
      `${API_BASE}/api/file?path=${encodeURIComponent(filePath)}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (
          destroyed ||
          !containerRef.current ||
          !data?.content
        )
          return;
        const m = data.content.match(
          /```(?:json)?\s*([\s\S]*?)\s*```/
        );
        if (!m) return;
        const mindData = JSON.parse(
          m[1]
        );
        if (mindData.nodeData?.topic)
          setMapTitle(
            mindData.nodeData.topic
          );
        containerRef.current.innerHTML =
          "";
        const me = new MindElixir({
          el: containerRef.current,
          direction: MindElixir.SIDE,
          editable: false,
          contextMenu: false,
          toolBar: false,
          keypress: false,
          theme: MINDMAP_EMBED_THEME
        });
        me.init(mindData);
        meRef.current = me;
      })
      .catch((err) =>
        console.error(
          "Failed to load embedded mindmap",
          err
        )
      );

    return () => {
      destroyed = true;
      try {
        meRef.current?.destroy();
      } catch {}
      meRef.current = null;
    };
  }, [filePath]);

  return (
    <NodeViewWrapper className="mindmap-embed my-4 border border-slate-800 rounded-xl overflow-hidden shadow-lg bg-[#0d1117] text-slate-200">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-[#161b22]/50">
        <div className="flex items-center gap-2 select-none">
          <Brain
            size={14}
            className="text-violet-400 shrink-0"
          />
          <span className="text-xs font-semibold text-slate-350 truncate">
            Mind Map: {mapTitle}
          </span>
        </div>
        <a
          href={`/${filePath}`}
          onClick={(e) => {
            e.preventDefault();
            props.extension.options.onSelectFile?.(
              filePath
            );
          }}
          className="text-[10px] text-violet-400 hover:text-violet-300 font-bold underline transition cursor-pointer select-none"
        >
          Open Map
        </a>
      </div>
      <div
        ref={containerRef}
        className="w-full"
        style={{
          height: "360px",
          background: "#0d1117"
        }}
      />
    </NodeViewWrapper>
  );
};

const MindmapNode = Node.create({
  name: "mindmap",
  group: "block",
  selectable: true,
  draggable: true,
  atom: true,

  addOptions() {
    return { onSelectFile: null };
  },

  addAttributes() {
    return { path: { default: null } };
  },

  parseHTML() {
    return [{ tag: "mindmap" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "mindmap",
      mergeAttributes(HTMLAttributes),
      "mindmap-embed"
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(
      MindMapEmbedComponent
    );
  }
});

const BookmarkComponent = (
  props: any
) => {
  const {
    url,
    title,
    description,
    image,
    favicon,
    siteName
  } = props.node.attrs;
  const [loading, setLoading] =
    useState(!title);

  useEffect(() => {
    if (title) return; // Already fetched and stored

    setLoading(true);
    const API_BASE = import.meta.env.DEV
      ? "http://localhost:8080"
      : "";
    fetch(
      `${API_BASE}/api/link-preview?url=${encodeURIComponent(url)}`
    )
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        props.updateAttributes({
          title: data.title || url,
          description:
            data.description || "",
          image: data.image || "",
          favicon: data.favicon || "",
          siteName: data.siteName || ""
        });
        setLoading(false);
      })
      .catch(() => {
        props.updateAttributes({
          title: url,
          description: "",
          image: "",
          favicon: "",
          siteName: ""
        });
        setLoading(false);
      });
  }, [url, title]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayTitle = title || url;
  const displayHost = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  })();

  return (
    <NodeViewWrapper className="bookmark-card my-4 border border-slate-800 bg-[#161b22]/40 hover:bg-[#161b22]/70 hover:border-violet-500/40 rounded-xl overflow-hidden shadow-md transition-all duration-200">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-stretch text-slate-200 no-underline cursor-pointer select-none"
        onClick={(e) =>
          e.stopPropagation()
        }
      >
        <div className="flex-1 p-4 min-w-0 flex flex-col justify-between">
          <div className="min-w-0">
            {loading ? (
              <div className="flex items-center space-x-2 text-slate-500 text-xs py-2">
                <Loader2 className="animate-spin w-3.5 h-3.5" />
                <span>
                  Loading link
                  preview...
                </span>
              </div>
            ) : (
              <>
                <h4 className="text-sm font-semibold text-slate-250 truncate leading-snug hover:text-violet-400 transition-colors">
                  {displayTitle}
                </h4>
                {description && (
                  <p className="text-xs text-slate-455 mt-1 line-clamp-2 leading-relaxed">
                    {description}
                  </p>
                )}
              </>
            )}
          </div>
          <div className="flex items-center space-x-2 mt-3 text-[11px] text-slate-500 min-w-0">
            {favicon ? (
              <img
                src={favicon}
                alt=""
                className="w-3.5 h-3.5 object-contain rounded shrink-0"
                onError={(e) => {
                  e.currentTarget.style.display =
                    "none";
                }}
              />
            ) : (
              <Link2
                size={12}
                className="text-slate-500 shrink-0"
              />
            )}
            <span className="font-semibold truncate text-slate-400">
              {siteName || displayHost}
            </span>
            <span className="text-slate-700 font-bold shrink-0">
              ·
            </span>
            <span className="truncate max-w-[150px] font-mono text-[10px] text-slate-500">
              {displayHost}
            </span>
          </div>
        </div>
        {image && !loading && (
          <div className="w-1/4 max-w-[140px] min-w-[100px] relative border-l border-slate-800 bg-[#0d1117] hidden sm:block">
            <img
              src={image}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
          </div>
        )}
      </a>
    </NodeViewWrapper>
  );
};

const BookmarkNode = Node.create({
  name: "bookmark",
  group: "block",
  selectable: true,
  draggable: true,
  atom: true,

  addAttributes() {
    return {
      url: {
        default: ""
      },
      title: {
        default: ""
      },
      description: {
        default: ""
      },
      image: {
        default: ""
      },
      favicon: {
        default: ""
      },
      siteName: {
        default: ""
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: "bookmark",
        getAttrs: (el) => {
          const e = el as HTMLElement;
          return {
            url:
              e.getAttribute("url") ||
              "",
            title:
              e.getAttribute("title") ||
              "",
            description:
              e.getAttribute(
                "description"
              ) || "",
            image:
              e.getAttribute("image") ||
              "",
            favicon:
              e.getAttribute(
                "favicon"
              ) || "",
            // browsers lowercase attribute names, so accept both cases
            siteName:
              e.getAttribute(
                "sitename"
              ) ||
              e.getAttribute(
                "siteName"
              ) ||
              ""
          };
        }
      }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // ZWNJ (U+200C) prevents Turndown's isBlank check from firing before our custom rule.
    return [
      "bookmark",
      mergeAttributes(HTMLAttributes),
      "‌"
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(
      BookmarkComponent
    );
  }
});

const LANGUAGES = [
  {
    value: "markdown",
    label: "Markdown"
  },
  {
    value: "javascript",
    label: "JavaScript"
  },
  {
    value: "typescript",
    label: "TypeScript"
  },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "python", label: "Python" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "csharp", label: "C#" },
  { value: "java", label: "Java" },
  { value: "php", label: "PHP" },
  { value: "ruby", label: "Ruby" },
  { value: "swift", label: "Swift" },
  { value: "kotlin", label: "Kotlin" },
  { value: "dart", label: "Dart" },
  {
    value: "bash",
    label: "Bash / Shell"
  },
  { value: "sql", label: "SQL" },
  { value: "xml", label: "XML" },
  {
    value: "dockerfile",
    label: "Dockerfile"
  },
  { value: "ini", label: "INI / Conf" },
  {
    value: "diff",
    label: "Diff / Patch"
  },
  { value: "lua", label: "Lua" },
  { value: "zig", label: "Zig" },
  {
    value: "wasm",
    label: "WebAssembly"
  },
  {
    value: "plain",
    label: "Plain Text"
  }
];

const CodeBlockComponent = (
  props: any
) => {
  const { language } = props.node.attrs;
  const [copied, setCopied] =
    useState(false);

  const handleLanguageChange = (
    e: React.ChangeEvent<HTMLSelectElement>
  ) => {
    props.updateAttributes({
      language: e.target.value
    });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(
        props.node.textContent || ""
      );
      setCopied(true);
      setTimeout(
        () => setCopied(false),
        2000
      );
    } catch (err) {
      console.error(
        "Failed to copy code",
        err
      );
    }
  };

  return (
    <NodeViewWrapper className="code-block-container my-4 relative rounded-xl overflow-hidden border border-slate-800 bg-[#0d1117] group">
      {/* Header with language selection */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-[#161b22] border-b border-slate-850 select-none">
        <select
          value={language || "markdown"}
          onChange={
            handleLanguageChange
          }
          className="bg-transparent text-slate-400 hover:text-slate-200 text-xs font-semibold focus:outline-none border-none py-0.5 pr-6 cursor-pointer rounded-lg transition-colors"
        >
          {LANGUAGES.map((lang) => (
            <option
              key={lang.value}
              value={lang.value}
              className="bg-[#161b22] text-slate-350"
            >
              {lang.label}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-3">
          <span className="text-[10px] text-slate-500 font-mono select-none opacity-0 group-hover:opacity-100 transition-opacity">
            Code Block
          </span>
          <button
            onClick={handleCopy}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold border transition duration-150 cursor-pointer ${
              copied
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                : "bg-slate-800/35 text-slate-400 border-transparent hover:border-slate-700 hover:text-slate-200 hover:bg-slate-800/70"
            }`}
          >
            {copied ? (
              <>
                <Check size={10} />
                Copied!
              </>
            ) : (
              <>
                <Copy size={10} />
                Copy
              </>
            )}
          </button>
        </div>
      </div>

      {/* Editor Content Area */}
      <pre
        style={{
          backgroundColor:
            "transparent",
          padding: "1rem",
          border: "none",
          margin: 0,
          borderRadius: 0
        }}
        className="overflow-x-auto text-xs font-mono text-slate-100 focus:outline-none leading-relaxed hljs"
      >
        <NodeViewContent
          as={"code" as any}
        />
      </pre>
    </NodeViewWrapper>
  );
};

const CustomCodeBlock =
  CodeBlockLowlight.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        language: {
          default: "markdown"
        }
      };
    },
    addNodeView() {
      return ReactNodeViewRenderer(
        CodeBlockComponent
      );
    }
  }).configure({ lowlight });

interface FileRecord {
  path: string;
  title: string;
  type: string;
  contentHash: string;
  updatedAt: string;
  frontMatter?: Record<string, string>;
}

interface EditorProps {
  filePath: string;
  initialContent: string;
  onSave: (
    content: string
  ) => Promise<void>;
  isSaving: boolean;
  frontMatter?: Record<string, string>;
  onUpdateFrontMatter?: (
    updates: Record<string, any>
  ) => Promise<void>;
  onTitleChange?: (
    newTitle: string
  ) => void | Promise<void>;
  boardColumns: string[];
  boardTags?: string[];
  tagColors?: Record<string, string>;
  onEnsureTagColor?: (tag: string) => void;
  onCreateSubPage?: (
    parentPath: string,
    onCreated: (
      newPath: string,
      title: string
    ) => string
  ) => void;
  onSelectFile?: (path: string) => void;
  files: FileRecord[];
  globalLayoutOverride?: string;
  globalColumnWidthOverride?: string;
  dateFormat?: string;
  highlightSearchTerm?: string | null;
  onClearSearchHighlight?: () => void;
  initialPropertiesCollapsed?: boolean;
  onSavePropertiesCollapsed?: (
    collapsed: boolean
  ) => void;
  autosaveDelay?: number;
}

interface HistoryVersion {
  timestamp: number;
  date: string;
  size: number;
}

const API_BASE = import.meta.env.DEV
  ? "http://localhost:8080"
  : "";

const getCommandIcon = (
  id: string,
  active: boolean
) => {
  const cls = active
    ? "text-violet-400"
    : "text-slate-400";
  const s = 14;
  switch (id) {
    case "h1":
      return (
        <Heading1
          size={s}
          className={cls}
        />
      );
    case "h2":
      return (
        <Heading2
          size={s}
          className={cls}
        />
      );
    case "h3":
      return (
        <Heading3
          size={s}
          className={cls}
        />
      );
    case "bullet":
      return (
        <List
          size={s}
          className={cls}
        />
      );
    case "number":
      return (
        <ListOrdered
          size={s}
          className={cls}
        />
      );
    case "task":
      return (
        <CheckSquare
          size={s}
          className={cls}
        />
      );
    case "quote":
      return (
        <Quote
          size={s}
          className={cls}
        />
      );
    case "toggle":
      return (
        <ChevronRight
          size={s}
          className={cls}
        />
      );
    case "table":
      return (
        <Grid
          size={s}
          className={cls}
        />
      );
    case "code":
      return (
        <Code2
          size={s}
          className={cls}
        />
      );
    case "subpage":
      return (
        <FilePlus
          size={s}
          className={cls}
        />
      );
    case "embed":
      return (
        <MonitorPlay
          size={s}
          className={cls}
        />
      );
    case "toc":
      return (
        <BookOpen
          size={s}
          className={cls}
        />
      );
    case "math":
      return (
        <Sigma
          size={s}
          className={cls}
        />
      );
    case "2col":
      return (
        <Columns2
          size={s}
          className={cls}
        />
      );
    case "3col":
      return (
        <Columns2
          size={s}
          className={cls}
        />
      );
    case "callout":
    case "callout-note":
      return (
        <Info
          size={s}
          className={cls}
        />
      );
    case "callout-tip":
      return (
        <Flame
          size={s}
          className={cls}
        />
      );
    case "callout-warning":
      return (
        <AlertTriangle
          size={s}
          className={cls}
        />
      );
    case "callout-danger":
      return (
        <Zap size={s} className={cls} />
      );
    case "callout-bug":
      return (
        <Bug size={s} className={cls} />
      );
    case "callout-todo":
      return (
        <ListTodo
          size={s}
          className={cls}
        />
      );
    case "callout-missing":
      return (
        <XCircle
          size={s}
          className={cls}
        />
      );
    case "callout-question":
      return (
        <HelpCircle
          size={s}
          className={cls}
        />
      );
    case "callout-summary":
      return (
        <FileText
          size={s}
          className={cls}
        />
      );
    case "callout-done":
      return (
        <CheckCircle2
          size={s}
          className={cls}
        />
      );
    case "date-picker":
      return (
        <Calendar
          size={s}
          className={cls}
        />
      );
    default:
      return (
        <Info
          size={s}
          className={cls}
        />
      );
  }
};

// Module-level ref so the image caption component (defined at module level) can
// trigger the image editor that lives inside the component.
const _imageClickRef = {
  current: (_src: string) => {}
};

// ── TocBlock node ──────────────────────────────────────────────────
const TocBlockComponent = (
  props: any
) => {
  const ed = props.editor;
  const [headings, setHeadings] =
    useState<
      {
        level: number;
        text: string;
        pos: number;
      }[]
    >([]);

  useEffect(() => {
    if (!ed) return;
    const update = () => {
      const hs: {
        level: number;
        text: string;
        pos: number;
      }[] = [];
      ed.state.doc.descendants(
        (node: any, pos: number) => {
          if (
            node.type.name === "heading"
          )
            hs.push({
              level: node.attrs.level,
              text: node.textContent,
              pos
            });
        }
      );
      setHeadings(hs);
    };
    update();
    ed.on("update", update);
    return () =>
      ed.off("update", update);
  }, [ed]);

  const jump = (pos: number) => {
    if (!ed) return;
    ed.commands.setTextSelection(
      pos + 1
    );
    ed.view.focus();
    const dom = ed.view.nodeDOM(pos);
    if (dom instanceof HTMLElement)
      dom.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
  };

  return (
    <NodeViewWrapper className="my-4">
      <div
        contentEditable={false}
        className="bf-toc-block border border-slate-700/60 rounded-xl p-4 bg-[#161b22]/60 select-none"
      >
        <div className="flex items-center gap-2 mb-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          <BookOpen
            size={11}
            className="text-violet-400"
          />
          Table of Contents
        </div>
        {headings.length === 0 ? (
          <p className="text-xs text-slate-500 italic">
            No headings found in this
            document.
          </p>
        ) : (
          <ul className="space-y-1">
            {headings.map((h, i) => (
              <li
                key={i}
                style={{
                  paddingLeft: `${(h.level - 1) * 14}px`
                }}
              >
                <button
                  onClick={() =>
                    jump(h.pos)
                  }
                  className="text-xs text-slate-300 hover:text-violet-400 hover:underline transition text-left w-full truncate leading-relaxed"
                >
                  {h.level > 1 && (
                    <span className="text-slate-600 mr-1">
                      {"–".repeat(
                        h.level - 1
                      )}
                    </span>
                  )}
                  {h.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </NodeViewWrapper>
  );
};

const TocBlockNode = Node.create({
  name: "tocBlock",
  group: "block",
  atom: true,
  parseHTML() {
    return [{ tag: "toc-block" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "toc-block",
      mergeAttributes(HTMLAttributes),
      "‌"
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(
      TocBlockComponent
    );
  }
});

// ── Multi-column layout nodes ─────────────────────────────────────
const ColumnNode = Node.create({
  name: "column",
  group: "block",
  content: "block+",
  defining: true,
  parseHTML() {
    return [
      { tag: "div[data-column]" }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-column": "true",
        style: "flex:1;min-width:0"
      }),
      0
    ];
  },
  addNodeView() {
    return () => {
      const dom =
        document.createElement("div");
      dom.setAttribute(
        "data-column",
        "true"
      );
      dom.style.cssText =
        "flex:1;min-width:0;padding:0 8px";
      const contentDOM =
        document.createElement("div");
      dom.appendChild(contentDOM);
      return { dom, contentDOM };
    };
  }
});

const ColumnsNode = Node.create({
  name: "columns",
  group: "block",
  content: "column{2,3}",
  defining: true,
  parseHTML() {
    return [
      { tag: "div[data-columns]" }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-columns": "true",
        style:
          "display:flex;gap:16px;align-items:flex-start"
      }),
      0
    ];
  },
  addNodeView() {
    return () => {
      const dom =
        document.createElement("div");
      dom.setAttribute(
        "data-columns",
        "true"
      );
      dom.style.cssText =
        "display:flex;gap:16px;align-items:flex-start;width:100%;margin:8px 0";
      const contentDOM =
        document.createElement("div");
      contentDOM.style.cssText =
        "display:contents";
      dom.appendChild(contentDOM);
      return { dom, contentDOM };
    };
  }
});

// ── ImageWithCaption node ──────────────────────────────────────────
const ImageCaptionComponent = (
  props: any
) => {
  const { src, alt, title, width } =
    props.node.attrs;
  const figureRef =
    useRef<HTMLElement>(null);
  const isResizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWRef = useRef(0);

  const onResizeStart = (
    e: React.MouseEvent
  ) => {
    e.preventDefault();
    e.stopPropagation();
    isResizingRef.current = true;
    startXRef.current = e.clientX;
    startWRef.current =
      figureRef.current?.offsetWidth ??
      400;
    const onMove = (ev: MouseEvent) => {
      if (!isResizingRef.current)
        return;
      const newW = Math.max(
        80,
        startWRef.current +
          (ev.clientX -
            startXRef.current)
      );
      props.updateAttributes({
        width: newW
      });
    };
    const onUp = () => {
      isResizingRef.current = false;
      document.removeEventListener(
        "mousemove",
        onMove
      );
      document.removeEventListener(
        "mouseup",
        onUp
      );
    };
    document.addEventListener(
      "mousemove",
      onMove
    );
    document.addEventListener(
      "mouseup",
      onUp
    );
  };

  return (
    <NodeViewWrapper className="image-caption-wrapper my-4">
      <figure
        ref={figureRef as any}
        contentEditable={false}
        className="group relative inline-block"
        style={{
          width: width
            ? `${width}px`
            : undefined,
          maxWidth: "100%"
        }}
      >
        <img
          src={src}
          alt={alt || ""}
          style={{
            width: "100%",
            display: "block"
          }}
          className="rounded-xl border border-slate-800 shadow-lg cursor-pointer"
          onClick={() =>
            _imageClickRef.current(src)
          }
          draggable={false}
        />
        {/* Resize handle */}
        <div
          onMouseDown={onResizeStart}
          title="Drag to resize"
          className="absolute bottom-1 right-1 w-3.5 h-3.5 rounded-sm bg-slate-400/80 hover:bg-violet-400 cursor-se-resize opacity-0 group-hover:opacity-100 transition-opacity shadow"
        />
        <figcaption>
          <input
            type="text"
            value={title || ""}
            onChange={(e) =>
              props.updateAttributes({
                title: e.target.value
              })
            }
            placeholder="Add a caption…"
            onMouseDown={(e) =>
              e.stopPropagation()
            }
            className="w-full bg-transparent text-center text-xs text-slate-500 placeholder-slate-600 focus:text-slate-300 outline-none border-b border-transparent focus:border-slate-700/60 pb-0.5 mt-2 transition-colors"
          />
        </figcaption>
      </figure>
    </NodeViewWrapper>
  );
};

const ImageWithCaption = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        renderHTML: (attrs) =>
          attrs.width
            ? {
                width: String(
                  attrs.width
                )
              }
            : {},
        parseHTML: (el) => {
          const w =
            el.getAttribute("width");
          return w
            ? parseInt(w, 10)
            : null;
        }
      }
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(
      ImageCaptionComponent
    );
  }
});

const toISODateInput = (
  d: Date
): string => {
  const y = d.getFullYear();
  const m = String(
    d.getMonth() + 1
  ).padStart(2, "0");
  const day = String(
    d.getDate()
  ).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const formatDisplayDate = (
  d: Date,
  format?: string
): string => {
  if (format === "iso") return toISODateInput(d);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
};

const COMMANDS = [
  {
    id: "h1",
    label: "Heading 1",
    desc: "Large section header",
    search: "h1 heading1 large text",
    shortcut: "# "
  },
  {
    id: "h2",
    label: "Heading 2",
    desc: "Medium section header",
    search: "h2 heading2 medium text",
    shortcut: "## "
  },
  {
    id: "h3",
    label: "Heading 3",
    desc: "Small section header",
    search: "h3 heading3 small text",
    shortcut: "### "
  },
  {
    id: "bullet",
    label: "Bullet List",
    desc: "Simple bulleted list",
    search: "bullet list unordered",
    shortcut: "- "
  },
  {
    id: "number",
    label: "Numbered List",
    desc: "Ordered numbered list",
    search: "number list ordered",
    shortcut: "1. "
  },
  {
    id: "task",
    label: "Task List",
    desc: "Checkbox checklist",
    search: "task todo checklist check",
    shortcut: "[] "
  },
  {
    id: "quote",
    label: "Blockquote",
    desc: "Indented block quote",
    search: "quote blockquote indent",
    shortcut: "> "
  },
  {
    id: "toggle",
    label: "Toggle List",
    desc: "Collapsible block that hides content until clicked",
    search:
      "toggle collapse expand details summary dropdown accordion",
    shortcut: undefined
  },
  {
    id: "code",
    label: "Code Block",
    desc: "Monospace fenced code block",
    search: "code block script pre",
    shortcut: "``` "
  },
  {
    id: "table",
    label: "Table Grid",
    desc: "Insert a 2x2 grid table",
    search: "table grid columns cell",
    shortcut: undefined
  },
  {
    id: "toc",
    label: "Table of Contents",
    desc: "Live auto-updating heading index",
    search:
      "toc table contents outline headings index",
    shortcut: undefined
  },
  {
    id: "callout",
    label: "Custom Callout",
    desc: "Fully customizable callout box",
    search: "callout note custom box",
    shortcut: undefined
  },
  {
    id: "callout-note",
    label: "Note Callout",
    desc: "Callout styled as a Note",
    search: "callout note box preset",
    shortcut: undefined
  },
  {
    id: "callout-tip",
    label: "Tip Callout",
    desc: "Callout styled as a Tip",
    search: "callout tip box preset",
    shortcut: undefined
  },
  {
    id: "callout-warning",
    label: "Warning Callout",
    desc: "Callout styled as a Warning",
    search:
      "callout warning box preset",
    shortcut: undefined
  },
  {
    id: "callout-danger",
    label: "Danger Callout",
    desc: "Callout styled as a Danger",
    search: "callout danger box preset",
    shortcut: undefined
  },
  {
    id: "callout-bug",
    label: "Bug Callout",
    desc: "Callout styled as a Bug",
    search: "callout bug box preset",
    shortcut: undefined
  },
  {
    id: "callout-todo",
    label: "Todo Callout",
    desc: "Callout styled as a Todo",
    search: "callout todo box preset",
    shortcut: undefined
  },
  {
    id: "callout-missing",
    label: "Missing Callout",
    desc: "Callout styled as Missing",
    search:
      "callout missing box preset",
    shortcut: undefined
  },
  {
    id: "callout-question",
    label: "Question Callout",
    desc: "Callout styled as a Question",
    search:
      "callout question box preset",
    shortcut: undefined
  },
  {
    id: "callout-summary",
    label: "Summary Callout",
    desc: "Callout styled as a Summary",
    search:
      "callout summary box preset",
    shortcut: undefined
  },
  {
    id: "callout-done",
    label: "Done Callout",
    desc: "Callout styled as Done",
    search: "callout done box preset",
    shortcut: undefined
  },
  {
    id: "subpage",
    label: "Sub-page",
    desc: "Create a sub-page inside this page",
    search:
      "subpage sub page child nested",
    shortcut: undefined
  },
  {
    id: "embed",
    label:
      "Embed Link / Canvas / Mind Map",
    desc: "Embed a website, canvas, or mind map",
    search:
      "embed iframe link website canvas drawio mindmap mind map brain",
    shortcut: undefined
  },
  {
    id: "math",
    label: "Math / KaTeX",
    desc: "Insert a LaTeX math expression — also type $formula$",
    search:
      "math latex katex formula equation",
    shortcut: undefined
  },
  {
    id: "2col",
    label: "Two Columns",
    desc: "Split content into two columns",
    search:
      "2 two columns layout split",
    shortcut: undefined
  },
  {
    id: "3col",
    label: "Three Columns",
    desc: "Split content into three columns",
    search:
      "3 three columns layout split",
    shortcut: undefined
  },
  {
    id: "date-picker",
    label: "Pick a Date...",
    desc: "Choose any date from a calendar",
    search:
      "date calendar picker select choose",
    shortcut: undefined
  }
];

// Stable module-level ref — avoids recreating the Mathematics extension on every render
const _mathClickRef: {
  current:
    | ((
        latex: string,
        pos: number
      ) => void)
    | null;
} = { current: null };

// Input rule: convert $formula$ → inlineMath node (extension's built-in only handles $$...$$)
const SingleDollarMath =
  Extension.create({
    name: "singleDollarMath",
    addInputRules() {
      return [
        new InputRule({
          // Single $…$ not adjacent to another $
          find: /(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/,
          handler: ({
            state,
            range,
            match
          }) => {
            const latex = match[1];
            const { tr } = state;
            const inlineMath = (
              state.schema.nodes as any
            ).inlineMath;
            if (!inlineMath) return;
            tr.replaceWith(
              range.from,
              range.to,
              inlineMath.create({
                latex
              })
            );
          }
        })
      ];
    }
  });

// Bracket/quote pairs that auto-close. Quotes map to their smart-quote glyphs
// directly (superseding Typography's plain straight-quote conversion for the
// pairing case) since both open and close use the same physical key.
const BRACKET_PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}"
};
const QUOTE_PAIRS: Record<
  string,
  [string, string]
> = {
  '"': ["“", "”"],
  "'": ["‘", "’"]
};
const PAIR_CLOSERS: Record<string, string> =
  {
    ...Object.fromEntries(
      Object.entries(BRACKET_PAIRS).map(
        ([open, close]) => [close, open]
      )
    ),
    "”": "“",
    "’": "‘"
  };

// Auto-pairing for quotes/brackets: typing an opening character inserts the
// matching closer with the cursor between them (or wraps a selection); typing
// a closing character that's already immediately ahead just steps over it
// instead of inserting a duplicate. Backtick is deliberately excluded since
// StarterKit's inline-code shortcut relies on typing a real closing backtick.
const AutoPair = Extension.create({
  name: "autoPair",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("autoPair"),
        props: {
          handleTextInput: (
            view,
            from,
            to,
            text
          ) => {
            if (text.length !== 1)
              return false;
            const { state } = view;
            const hasSelection =
              from !== to;
            const docSize =
              state.doc.content.size;
            const charAfter =
              to < docSize
                ? state.doc.textBetween(
                    to,
                    to + 1
                  )
                : "";

            const wrapOrInsert = (
              open: string,
              close: string
            ) => {
              let tr = state.tr;
              if (hasSelection) {
                tr = tr.insertText(
                  close,
                  to,
                  to
                );
                tr = tr.insertText(
                  open,
                  from,
                  from
                );
                tr = tr.setSelection(
                  TextSelection.create(
                    tr.doc,
                    from + open.length,
                    from +
                      open.length +
                      (to - from)
                  )
                );
              } else {
                tr = tr.insertText(
                  open + close,
                  from,
                  from
                );
                tr = tr.setSelection(
                  TextSelection.create(
                    tr.doc,
                    from + open.length
                  )
                );
              }
              view.dispatch(tr);
              return true;
            };

            // Step over a closing bracket that's already right there
            if (
              !hasSelection &&
              Object.values(
                BRACKET_PAIRS
              ).includes(text) &&
              charAfter === text
            ) {
              view.dispatch(
                state.tr.setSelection(
                  TextSelection.create(
                    state.doc,
                    to + 1
                  )
                )
              );
              return true;
            }

            // Opening bracket — always pair
            if (BRACKET_PAIRS[text]) {
              return wrapOrInsert(
                text,
                BRACKET_PAIRS[text]
              );
            }

            // Quotes: step over an already-adjacent smart closing quote
            const quotePair =
              QUOTE_PAIRS[text];
            if (
              !hasSelection &&
              quotePair &&
              charAfter === quotePair[1]
            ) {
              view.dispatch(
                state.tr.setSelection(
                  TextSelection.create(
                    state.doc,
                    to + 1
                  )
                )
              );
              return true;
            }

            // Quotes only auto-pair at a word boundary (start of block, after
            // whitespace/opening punctuation) or when wrapping a selection.
            // Mid-word (e.g. the apostrophe in "don't") just converts to the
            // closing smart-quote glyph in place, no pairing. This extension
            // owns quote handling end-to-end rather than deferring to
            // Typography's own quote rules: tiptap always runs the combined
            // input-rules plugin before any extension's custom
            // addProseMirrorPlugins, so Typography would otherwise intercept
            // every quote keystroke before this plugin ever saw it — see the
            // Typography.configure() call below that turns its quote options
            // off to avoid the two fighting over the same keystroke.
            if (quotePair) {
              if (hasSelection) {
                return wrapOrInsert(
                  quotePair[0],
                  quotePair[1]
                );
              }
              const charBefore =
                from > 0
                  ? state.doc.textBetween(
                      from - 1,
                      from
                    )
                  : "";
              const atBoundary =
                charBefore === "" ||
                /[\s([{<'"‘“]/.test(
                  charBefore
                );
              if (atBoundary) {
                return wrapOrInsert(
                  quotePair[0],
                  quotePair[1]
                );
              }
              view.dispatch(
                state.tr.insertText(
                  quotePair[1],
                  from,
                  to
                )
              );
              return true;
            }

            return false;
          }
        }
      })
    ];
  },
  addKeyboardShortcuts() {
    return {
      // Deleting between an empty pair removes both characters together
      // instead of leaving an orphaned opening/closing character behind.
      Backspace: () => {
        const { state, view } =
          this.editor;
        const dispatch = (
          tr: typeof state.tr
        ) => view.dispatch(tr);
        const { selection } = state;
        if (!selection.empty)
          return false;
        const pos = selection.from;
        if (
          pos < 1 ||
          pos >= state.doc.content.size
        )
          return false;
        const before =
          state.doc.textBetween(
            pos - 1,
            pos
          );
        const after =
          state.doc.textBetween(
            pos,
            pos + 1
          );
        if (
          PAIR_CLOSERS[after] === before
        ) {
          dispatch(
            state.tr.delete(
              pos - 1,
              pos + 1
            )
          );
          return true;
        }
        return false;
      }
    };
  }
});

// ─── CalendarPopover ────────────────────────────────────────────────────────
// A custom month-grid date picker, styled like this app's other floating
// menus (dark card, violet accent). Native <input type="date"> desktop
// calendars can't be restyled at all — no header, no theming, browsers draw
// that popup themselves — so this replaces it outright rather than trying to
// reskin something CSS has no access to.
const CalendarPopover: React.FC<{
  value: string; // 'YYYY-MM-DD' or ''
  anchorRect: { top: number; left: number; bottom: number };
  onChange: (date: string) => void;
  onClose: () => void;
}> = ({ value, anchorRect, onChange, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const parsed = value ? new Date(value + "T00:00:00") : null;
  const [viewYear, setViewYear] = useState(
    (parsed ?? new Date()).getFullYear()
  );
  const [viewMonth, setViewMonth] = useState(
    (parsed ?? new Date()).getMonth()
  );

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Element))
        onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);

  const fmt = (y: number, m: number, d: number) => {
    const dt = new Date(y, m, d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  };

  const today = new Date();
  const todayStr = fmt(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startWeekday = firstOfMonth.getDay(); // 0 = Sunday
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  const cells: {
    day: number;
    month: number;
    year: number;
    inCurrent: boolean;
  }[] = [];
  for (let i = startWeekday - 1; i >= 0; i--) {
    cells.push({
      day: daysInPrevMonth - i,
      month: viewMonth - 1,
      year: viewYear,
      inCurrent: false
    });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, month: viewMonth, year: viewYear, inCurrent: true });
  }
  let nextDay = 1;
  while (cells.length < 42) {
    cells.push({
      day: nextDay++,
      month: viewMonth + 1,
      year: viewYear,
      inCurrent: false
    });
  }

  const goPrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };
  const goNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed",
        top: anchorRect.bottom + 6,
        left: anchorRect.left,
        zIndex: 9999
      }}
      className="w-64 bg-[#161b22] border border-slate-700/80 rounded-xl shadow-2xl p-3 select-none animate-in fade-in zoom-in-95 duration-100"
    >
      <div className="flex items-center justify-between mb-2 px-0.5">
        <button
          type="button"
          onClick={goPrevMonth}
          className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-xs font-bold text-slate-200">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <button
          type="button"
          onClick={goNextMonth}
          className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
          <span
            key={d}
            className="text-[9px] font-semibold text-slate-500 text-center uppercase"
          >
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((c, i) => {
          const dateStr = fmt(c.year, c.month, c.day);
          const isSelected = value === dateStr;
          const isToday = todayStr === dateStr;
          return (
            <button
              key={i}
              type="button"
              onClick={() => {
                onChange(dateStr);
                onClose();
              }}
              className={`h-7 w-7 mx-auto flex items-center justify-center text-[11px] rounded-lg transition cursor-pointer ${
                isSelected
                  ? "bg-violet-600 text-white font-bold"
                  : c.inCurrent
                    ? `text-slate-300 hover:bg-slate-800 ${isToday ? "font-bold text-violet-400" : ""}`
                    : "text-slate-600 hover:bg-slate-800/50"
              }`}
            >
              {c.day}
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-slate-800">
        <button
          type="button"
          onClick={() => {
            onChange(todayStr);
            onClose();
          }}
          className="text-[10px] font-semibold text-violet-400 hover:text-violet-300 transition cursor-pointer"
        >
          Today
        </button>
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              onClose();
            }}
            className="text-[10px] font-semibold text-slate-500 hover:text-red-400 transition cursor-pointer"
          >
            Clear
          </button>
        )}
      </div>
    </div>,
    document.body
  );
};

export const Editor: React.FC<
  EditorProps
> = ({
  filePath,
  initialContent,
  onSave,
  isSaving,
  frontMatter,
  onUpdateFrontMatter,
  onTitleChange,
  boardColumns,
  boardTags = [],
  tagColors = {},
  onEnsureTagColor,
  onCreateSubPage,
  onSelectFile,
  files,
  globalLayoutOverride,
  globalColumnWidthOverride,
  dateFormat,
  highlightSearchTerm,
  onClearSearchHighlight,
  initialPropertiesCollapsed = false,
  onSavePropertiesCollapsed,
  autosaveDelay = 1500
}) => {
  // Mobile browsers already render a well-fitted native date picker on tap
  // (unlike desktop, which needs the tiny calendar glyph clicked exactly and
  // then draws a plain, unstyled grid) — so the custom CalendarPopover below
  // is desktop-only; mobile keeps the native <input type="date">.
  const isMobile = useIsMobile();

  // The full formatting toolbar is collapsed by default on mobile — it's too
  // tall to show alongside actual content on a phone screen.
  const [
    mobileToolbarOpen,
    setMobileToolbarOpen
  ] = useState(false);

  // Slash command states
  const [
    commandActive,
    setCommandActive
  ] = useState(false);
  const [
    commandQuery,
    setCommandQuery
  ] = useState("");
  const [
    commandCoords,
    setCommandCoords
  ] = useState({ top: 0, left: 0 });
  const [
    selectedIndex,
    setSelectedIndex
  ] = useState(0);

  // Auto-save states
  const [saveStatus, setSaveStatus] =
    useState<
      "saved" | "saving" | "dirty"
    >("saved");
  // Set when an SSE file_update for this same file arrives while the editor
  // is focused — the content-sync effect below deliberately won't clobber
  // active typing, but silently ignoring it entirely just delays the same
  // overwrite until the next autosave. This surfaces it instead of hiding it.
  const [remoteConflict, setRemoteConflict] =
    useState(false);
  const saveTimeoutRef = useRef<
    any | null
  >(null);
  // Serializes autosave cycles: a title change makes executeAutoSave await a
  // rename (save-to-old-path, then move-to-new-path) via onTitleChangeRef —
  // if the user keeps typing, the debounce below can fire a *second*
  // executeAutoSave while that rename is still in flight. Without chaining,
  // that second call still targets the pre-rename path (React hasn't
  // committed the new selectedPath yet), and the backend's plain
  // MkdirAll+WriteFile happily recreates the old file the rename just moved
  // away from — a resurrected duplicate card with stale title/content. Route
  // every autosave through this chain so the next one can't start until the
  // previous one's save+rename has fully landed.
  const saveChainRef = useRef<
    Promise<void>
  >(Promise.resolve());
  // useEditor() has no deps array, so its onUpdate callback is captured once at
  // mount and never refreshed — reading autosaveDelay through a ref (kept fresh
  // every render below) instead of the prop directly avoids that stale closure.
  const autosaveDelayRef = useRef(
    autosaveDelay
  );
  // Same staleness trap applies to onSave/onTitleChange: executeAutoSave is
  // only ever invoked from that same frozen onUpdate callback, so calling the
  // props directly would keep using whatever onSave closure existed at mount
  // time (e.g. App.tsx's handleSaveFile with the front matter string as it was
  // when the file was first opened) — silently reverting any front-matter-only
  // change (tags, status, cover, ...) made afterward on the very next autosave.
  const onSaveRef = useRef(onSave);
  const onTitleChangeRef = useRef(
    onTitleChange
  );

  // Draft state for the two title-editing surfaces (the big in-editor
  // title heading, and the Page Attributes Title field) — both hold local
  // text while being edited and only commit (via commitTitleChange, which
  // triggers the actual rename) on blur/Enter, not per-keystroke. null =
  // not currently editing that surface.
  const [
    titleDraft,
    setTitleDraft
  ] = useState<string | null>(null);
  const [
    pageAttrTitleDraft,
    setPageAttrTitleDraft
  ] = useState<string | null>(null);
  // Escape sets the draft to null AND blurs the input in the same
  // synchronous handler — but the blur handler's closure still sees the
  // pre-Escape draft (state updates aren't applied until the next render),
  // so without this ref it would go ahead and commit the very edit Escape
  // was supposed to cancel. Set synchronously right before blur(), read
  // once in onBlur.
  const titleCancelRef = useRef(false);
  const pageAttrTitleCancelRef = useRef(
    false
  );

  // The only thing allowed to change the page title now — routes through
  // onTitleChange (the same rename flow already used for Kanban card
  // titles: rewrites frontmatter `title:` + the saved file's H1, and moves
  // the file on disk if the slug changes), so both editing surfaces above
  // always agree with the saved file instead of drifting out of sync.
  const commitTitleChange = async (
    newTitle: string
  ) => {
    const trimmed = newTitle.trim();
    if (
      !trimmed ||
      trimmed ===
        frontMatterTitleRef.current
    )
      return;
    await onTitleChangeRef.current?.(
      trimmed
    );
  };

  // Version history states
  const [historyOpen, setHistoryOpen] =
    useState(false);
  const [
    exportDropdownOpen,
    setExportDropdownOpen
  ] = useState(false);
  const [historyList, setHistoryList] =
    useState<HistoryVersion[]>([]);
  const [
    isLoadingHistory,
    setIsLoadingHistory
  ] = useState(false);
  const [
    previewVersion,
    setPreviewVersion
  ] = useState<{
    timestamp: number;
    date: string;
    content: string;
  } | null>(null);
  const [
    isPreviewLoading,
    setIsPreviewLoading
  ] = useState(false);

  // Tag manager input state
  const [newTagInput, setNewTagInput] =
    useState("");
  const [
    tagAutocompleteOpen,
    setTagAutocompleteOpen
  ] = useState(false);
  const tagFieldRef = useRef<HTMLFormElement>(null);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const [tagDropPos, setTagDropPos] =
    useState<{ top: number; left: number } | null>(null);

  // Due-date calendar popover (Page Attributes panel)
  const dueDateBoxRef = useRef<HTMLDivElement>(null);
  const [dueDateCalendarOpen, setDueDateCalendarOpen] = useState(false);
  const [dueDateAnchorRect, setDueDateAnchorRect] = useState<{
    top: number;
    left: number;
    bottom: number;
  } | null>(null);
  const [
    textColorOpen,
    setTextColorOpen
  ] = useState(false);
  const [bgColorOpen, setBgColorOpen] =
    useState(false);
  // Separate open-state from the main toolbar's text/bg color pickers above —
  // both can be visible on screen at once (the toolbar is pinned above the
  // document regardless of selection), so sharing state would pop both
  // dropdowns open together whenever either one's button is clicked.
  const [
    bubbleTextColorOpen,
    setBubbleTextColorOpen
  ] = useState(false);
  const [
    bubbleBgColorOpen,
    setBubbleBgColorOpen
  ] = useState(false);
  const [
    attachmentDragOver,
    setAttachmentDragOver
  ] = useState(false);
  const [
    attachmentUploading,
    setAttachmentUploading
  ] = useState(false);
  const attachmentInputRef =
    useRef<HTMLInputElement>(null);
  const coverInputRef =
    useRef<HTMLInputElement>(null);
  // Stable ref so the paste handler always calls the latest uploadAttachment
  const uploadAttachmentRef = useRef<
    (file: File) => Promise<void>
  >(async () => {});
  const [
    imgPreviewUrl,
    setImgPreviewUrl
  ] = useState<string | null>(null);
  const [
    imgPreviewPos,
    setImgPreviewPos
  ] = useState<{
    top: number;
    left: number;
  } | null>(null);

  // Bubble menu state (floating formatting bar on text selection)
  const [
    bubbleVisible,
    setBubbleVisible
  ] = useState(false);
  const [
    bubbleCoords,
    setBubbleCoords
  ] = useState({ top: 0, left: 0 });
  const bubbleRef = useRef<HTMLDivElement>(null);
  // Real measured size of the bubble, refreshed every time it's shown — the
  // positioning math used to assume a fixed 410x44 regardless of its actual
  // rendered size (35px tall in practice), which threw off both the "how
  // much room is above" check and the gap underneath when it flipped below.
  // Falls back to that same estimate only for the very first paint, before
  // there's anything to measure yet.
  const bubbleSizeRef = useRef({ width: 410, height: 44 });

  // Word count + reading time
  const [wordCount, setWordCount] =
    useState(0);

  // TOC sidebar
  const [tocOpen, setTocOpen] =
    useState(false);
  const [tocHeadings, setTocHeadings] =
    useState<
      {
        level: number;
        text: string;
        pos: number;
      }[]
    >([]);

  // Slideshow presentation mode
  const [
    slideshowOpen,
    setSlideshowOpen
  ] = useState(false);

  // Font size control
  const [
    editorFontSize,
    setEditorFontSize
  ] = useState<"sm" | "base" | "lg">(
    "base"
  );

  // Drag handle block menu
  const dragHandleEl =
    useRef<HTMLDivElement>(
      document.createElement("div")
    );
  const dragNodeRef = useRef<{
    node: any;
    editor: any;
    pos: number;
  } | null>(null);
  const [blockMenu, setBlockMenu] =
    useState<{
      open: boolean;
      coords: {
        top: number;
        left: number;
      };
      pos: number;
      submenu:
        | "transform"
        | "color"
        | null;
    } | null>(null);

  // Right-click context menu
  const [contextMenu, setContextMenu] =
    useState<{
      open: boolean;
      coords: {
        top: number;
        left: number;
      };
      pos: number;
    } | null>(null);

  // Link hover preview
  const [linkPreview, setLinkPreview] =
    useState<{
      href: string;
      title: string;
      excerpt: string;
      coords: {
        top: number;
        left: number;
      };
    } | null>(null);
  const linkPreviewTimer =
    useRef<ReturnType<
      typeof setTimeout
    > | null>(null);

  // Table cell color picker
  const [
    tableCellColorOpen,
    setTableCellColorOpen
  ] = useState(false);

  // Backlinks panel
  const [
    backlinksOpen,
    setBacklinksOpen
  ] = useState(false);
  const [backlinks, setBacklinks] =
    useState<
      {
        path: string;
        title: string;
        excerpt: string;
      }[]
    >([]);
  const [
    backlinksLoading,
    setBacklinksLoading
  ] = useState(false);

  // Page icon (emoji stored in frontmatter)
  const [
    iconPickerOpen,
    setIconPickerOpen
  ] = useState(false);

  // Cover image position control
  const [
    coverRepositioning,
    setCoverRepositioning
  ] = useState(false);
  const [coverPosY, setCoverPosY] =
    useState(50);

  useEffect(() => {
    const saved =
      frontMatter?.coverPositionY;
    const n =
      typeof saved === "number"
        ? saved
        : Number(saved);
    setCoverPosY(
      Number.isFinite(n) ? n : 50
    );
  }, [filePath]);

  // Math formula edit popover
  const [mathEdit, setMathEdit] =
    useState<{
      pos: number;
      latex: string;
      x: number;
      y: number;
    } | null>(null);
  const [
    mathEditDraft,
    setMathEditDraft
  ] = useState("");

  // "/date" calendar picker popover
  const [dateEdit, setDateEdit] =
    useState<{
      x: number;
      y: number;
    } | null>(null);
  const [
    dateEditDraft,
    setDateEditDraft
  ] = useState("");
  const dateInputRef =
    useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!dateEdit) return;
    const raf = requestAnimationFrame(
      () => {
        try {
          dateInputRef.current?.showPicker?.();
        } catch {
          // showPicker() is unsupported/blocked in some browsers —
          // the input remains usable via a normal click either way.
        }
      }
    );
    return () =>
      cancelAnimationFrame(raf);
  }, [dateEdit]);

  _mathClickRef.current = (
    latex: string,
    pos: number
  ) => {
    if (!editor) return;
    const domNode =
      editor.view.nodeDOM(pos);
    if (domNode) {
      const rect = (
        domNode as Element
      ).getBoundingClientRect();
      setMathEditDraft(latex);
      setMathEdit({
        pos,
        latex,
        x: rect.left,
        y: rect.bottom + 10
      });
    }
  };

  // Image Viewer & Editor state
  const [
    editingImageSrc,
    setEditingImageSrc
  ] = useState<string | null>(null);

  // Embed states
  const [
    embedModalOpen,
    setEmbedModalOpen
  ] = useState(false);
  const [embedType, setEmbedType] =
    useState<
      "url" | "drawio" | "mindmap"
    >("url");
  const [embedUrl, setEmbedUrl] =
    useState("");
  const [
    selectedCanvasPath,
    setSelectedCanvasPath
  ] = useState("");
  const [
    selectedMindmapPath,
    setSelectedMindmapPath
  ] = useState("");

  // Layout state (left, center, full)
  const [localLayout, setLocalLayout] =
    useState<
      "left" | "center" | "full"
    >("left");
  const pageLayout =
    frontMatter && onUpdateFrontMatter
      ? (frontMatter.layout as
          | "left"
          | "center"
          | "full") || "left"
      : localLayout;

  // Apply global layout override if set
  const layout =
    globalLayoutOverride &&
    globalLayoutOverride !== "per-page"
      ? (globalLayoutOverride as
          | "left"
          | "center"
          | "full")
      : pageLayout;

  // Column width / lateral margins state (narrow, normal, wide) for left & center aligned modes
  const [
    localColumnWidth,
    setLocalColumnWidth
  ] = useState<
    "narrow" | "normal" | "wide"
  >("normal");
  const pageColumnWidth =
    frontMatter && onUpdateFrontMatter
      ? (frontMatter.columnWidth as
          | "narrow"
          | "normal"
          | "wide") || "normal"
      : localColumnWidth;

  // Apply global column width override if set
  const columnWidth =
    globalColumnWidthOverride &&
    globalColumnWidthOverride !==
      "per-page"
      ? (globalColumnWidthOverride as
          | "narrow"
          | "normal"
          | "wide")
      : pageColumnWidth;

  const getWidthClass = () => {
    if (layout === "full")
      return "max-w-none w-full";
    const widthKey =
      columnWidth === "narrow"
        ? "max-w-2xl"
        : columnWidth === "wide"
          ? "max-w-6xl"
          : "max-w-4xl";
    if (layout === "center")
      return `${widthKey} mx-auto w-full`;
    return widthKey;
  };

  // Mention states
  const [
    mentionActive,
    setMentionActive
  ] = useState(false);
  const [
    mentionQuery,
    setMentionQuery
  ] = useState("");
  const [
    mentionCoords,
    setMentionCoords
  ] = useState({ top: 0, left: 0 });
  const [
    mentionSelectedIndex,
    setMentionSelectedIndex
  ] = useState(0);

  // Emoji suggestions states
  const [emojiActive, setEmojiActive] =
    useState(false);
  const [emojiQuery, setEmojiQuery] =
    useState("");
  const [emojiCoords, setEmojiCoords] =
    useState({ top: 0, left: 0 });
  const [
    emojiSelectedIndex,
    setEmojiSelectedIndex
  ] = useState(0);
  const [
    propertiesCollapsed,
    setPropertiesCollapsed
  ] = useState(
    initialPropertiesCollapsed
  );
  useEffect(() => {
    fetch(`${API_BASE}/api/settings`)
      .then((r) => r.json())
      .then((d) => {
        if (
          typeof d?.properties_collapsed ===
          "boolean"
        )
          setPropertiesCollapsed(
            d.properties_collapsed
          );
      })
      .catch(() => {});
  }, []);

  const emojiActiveRef = useRef(
    emojiActive
  );
  const emojiSelectedIndexRef = useRef(
    emojiSelectedIndex
  );
  const emojiQueryRef =
    useRef(emojiQuery);
  const inlineEmojiPickerRef =
    useRef<HTMLDivElement>(null);

  // Link paste non-blocking toast state
  const [pasteInfo, setPasteInfo] =
    useState<{
      url: string;
      from: number;
      to: number;
      x: number;
      y: number;
    } | null>(null);
  const pasteInfoRef =
    useRef(pasteInfo);
  useEffect(() => {
    pasteInfoRef.current = pasteInfo;
  }, [pasteInfo]);
  const [
    pasteSelectedIndex,
    setPasteSelectedIndex
  ] = useState(0);
  const pasteSelectedIndexRef = useRef(
    pasteSelectedIndex
  );

  const lastSavedContentRef =
    useRef<string>(
      initialContent || ""
    );
  const lastFilePathRef = useRef<
    string | null
  >(null);

  // Always-current reference to the frontmatter title — updated on every render
  // so the file-load effect and the title-commit handler can read the latest
  // value without a dep-loop.
  const frontMatterTitleRef =
    useRef<string>(
      frontMatter?.title || ""
    );
  frontMatterTitleRef.current =
    frontMatter?.title || "";

  // Click outside to close paste popup
  useEffect(() => {
    if (!pasteInfo) return;
    const handler = (e: MouseEvent) => {
      const el =
        document.getElementById(
          "link-paste-popup"
        );
      if (
        el &&
        !el.contains(e.target as any)
      ) {
        setPasteInfo(null);
      }
    };
    const t = setTimeout(() => {
      document.addEventListener(
        "mousedown",
        handler
      );
    }, 50);
    return () => {
      clearTimeout(t);
      document.removeEventListener(
        "mousedown",
        handler
      );
    };
  }, [pasteInfo]);

  // Close color pickers on outside click
  useEffect(() => {
    if (
      !textColorOpen &&
      !bgColorOpen &&
      !bubbleTextColorOpen &&
      !bubbleBgColorOpen
    )
      return;
    const close = (e: MouseEvent) => {
      if (
        !(
          e.target as Element
        )?.closest?.(
          "[data-color-picker]"
        )
      ) {
        setTextColorOpen(false);
        setBgColorOpen(false);
        setBubbleTextColorOpen(false);
        setBubbleBgColorOpen(false);
      }
    };
    document.addEventListener(
      "mousedown",
      close
    );
    return () =>
      document.removeEventListener(
        "mousedown",
        close
      );
  }, [
    textColorOpen,
    bgColorOpen,
    bubbleTextColorOpen,
    bubbleBgColorOpen
  ]);

  // Click outside & Escape key to close inline emoji picker
  useEffect(() => {
    if (!emojiActive) return;
    const handleMouseDown = (
      e: MouseEvent
    ) => {
      if (
        inlineEmojiPickerRef.current &&
        !inlineEmojiPickerRef.current.contains(
          e.target as any
        )
      ) {
        setEmojiActive(false);
      }
    };
    const handleKeyDown = (
      e: KeyboardEvent
    ) => {
      if (e.key === "Escape") {
        setEmojiActive(false);
      }
    };
    const t = setTimeout(() => {
      document.addEventListener(
        "mousedown",
        handleMouseDown
      );
      document.addEventListener(
        "keydown",
        handleKeyDown
      );
    }, 50);
    return () => {
      clearTimeout(t);
      document.removeEventListener(
        "mousedown",
        handleMouseDown
      );
      document.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  }, [emojiActive]);

  const toEmbedUrl = (url: string) => {
    // YouTube Watch URLs and short links
    const ytMatch1 = url.match(
      /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/
    );
    if (ytMatch1) {
      return `https://www.youtube.com/embed/${ytMatch1[1]}`;
    }
    // YouTube Shorts
    const ytShortsMatch = url.match(
      /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
    );
    if (ytShortsMatch) {
      return `https://www.youtube.com/embed/${ytShortsMatch[1]}`;
    }
    // Vimeo URLs
    const vimeoMatch = url.match(
      /vimeo\.com\/(?:video\/)?(\d+)/
    );
    if (vimeoMatch) {
      return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
    }
    return url;
  };

  const handleToastConvert = (
    type: "bookmark" | "embed"
  ) => {
    // Reads pasteInfoRef rather than the pasteInfo closure variable so this
    // still works when invoked from the editor's handleKeyDown, whose
    // closure is captured once at mount (see the useEditor() comment below).
    const info = pasteInfoRef.current;
    if (!info || !editor) return;
    const { url, from, to } = info;
    setPasteInfo(null);

    const content =
      type === "bookmark"
        ? {
            type: "bookmark",
            attrs: {
              url,
              title: "",
              description: "",
              image: "",
              favicon: "",
              siteName: ""
            }
          }
        : {
            type: "iframe",
            attrs: {
              src: toEmbedUrl(url),
              width: "100%",
              height: "450px"
            }
          };

    editor
      .chain()
      .focus()
      .setTextSelection({ from, to })
      .deleteSelection()
      .insertContent(content)
      .run();
    triggerAutoSave();
  };

  // Avoid stale closures in TipTap callback handlers via refs
  const commandActiveRef = useRef(
    commandActive
  );
  const selectedIndexRef = useRef(
    selectedIndex
  );
  const commandQueryRef = useRef(
    commandQuery
  );
  const commandListRef =
    useRef<HTMLDivElement>(null);

  const mentionActiveRef = useRef(
    mentionActive
  );
  const mentionSelectedIndexRef =
    useRef(mentionSelectedIndex);
  const mentionQueryRef = useRef(
    mentionQuery
  );

  const getHTMLFromMarkdown =
    markdownToEditorHtml;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        link: false
      }),
      // tiptap's Link mark hardcodes inclusive() to mirror the `autolink`
      // option (see @tiptap/extension-link's source) — since autolink
      // defaults to true, so does inclusive, meaning the cursor stays
      // "inside" the mark after a pasted/typed/inserted link: the very next
      // character (e.g. the space you type to start a new sentence) gets
      // absorbed into the hyperlink instead of starting plain text. This
      // overrides just that method so the link mark stops extending past
      // its own end, without touching autolink/linkOnPaste (typing a raw
      // URL, or pasting one, still auto-links exactly as before).
      Link.extend({
        inclusive() {
          return false;
        }
      }).configure({
        openOnClick: false,
        HTMLAttributes: {
          class:
            "mention-link text-violet-400 font-semibold underline hover:text-violet-300 cursor-pointer"
        }
      }),
      ImageWithCaption,
      TocBlockNode,
      ColumnsNode,
      ColumnNode,
      SingleDollarMath,
      Mathematics.configure({
        inlineOptions: {
          onClick: (
            node: any,
            pos: number
          ) => {
            _mathClickRef.current?.(
              node.attrs
                .latex as string,
              pos
            );
          }
        }
      }),
      DragHandle.configure({
        render: () =>
          dragHandleEl.current,
        onNodeChange: (data: any) => {
          dragNodeRef.current = data;
        },
        nested: true
      }),
      TaskList,
      TaskItem.configure({
        nested: true
      }),
      Table.configure({
        resizable: true
      }),
      TableRow,
      TableHeader,
      TableCell,
      IframeNode,
      BookmarkNode,
      CustomCodeBlock,
      CalloutNode,
      DrawioNode.configure({
        onSelectFile: (path: string) =>
          onSelectFile?.(path)
      } as any),
      ExcalidrawNode.configure({
        onSelectFile: (path: string) =>
          onSelectFile?.(path)
      } as any),
      MindmapNode.configure({
        onSelectFile: (path: string) =>
          onSelectFile?.(path)
      } as any),
      Placeholder.configure({
        placeholder:
          "Start typing, or press / for commands…",
        emptyEditorClass:
          "is-editor-empty",
        emptyNodeClass: "is-empty",
        showOnlyCurrent: false
      }),
      TextStyle,
      Color,
      Highlight.configure({
        multicolor: true
      }),
      UnderlineExtension,
      Details,
      DetailsSummary,
      DetailsContent,
      // Quote conversion is handled entirely by AutoPair (see its comments) —
      // disable Typography's own quote rules so the two don't fight over the
      // same keystroke.
      Typography.configure({
        openDoubleQuote: false,
        closeDoubleQuote: false,
        openSingleQuote: false,
        closeSingleQuote: false
      }),
      AutoPair,
      Subscript.extend({
        excludes: "superscript"
      }),
      Superscript.extend({
        excludes: "subscript"
      })
    ],
    content: getHTMLFromMarkdown(
      initialContent
    ),
    editorProps: {
      attributes: {
        class:
          "prose prose-invert max-w-none focus:outline-none min-h-[450px] text-slate-200 px-4 py-2"
      },
      handlePaste: (view, event) => {
        const items =
          event.clipboardData?.items;
        if (items) {
          let hasImage = false;
          for (
            let i = 0;
            i < items.length;
            i++
          ) {
            if (
              items[i].type.indexOf(
                "image"
              ) !== -1
            ) {
              const file =
                items[i].getAsFile();
              if (file) {
                hasImage = true;
                uploadImageAndInsert(
                  file
                );
              }
            }
          }
          if (hasImage) return true;
        }

        const pastedText =
          event.clipboardData
            ?.getData("text/plain")
            ?.trim();
        if (
          pastedText &&
          /^https?:\/\/[^\s]+$/i.test(
            pastedText
          )
        ) {
          const { state, dispatch } =
            view;
          const { selection } = state;

          // Insert standard link node
          const linkMark =
            state.schema.marks.link.create(
              { href: pastedText }
            );
          const textNode =
            state.schema.text(
              pastedText,
              [linkMark]
            );
          const tr =
            state.tr.replaceSelectionWith(
              textNode
            );
          tr.removeStoredMark(
            state.schema.marks.link
          );
          dispatch(tr);

          triggerAutoSave();

          try {
            const coords =
              view.coordsAtPos(
                selection.from
              );
            const menuH = 150;
            const menuW = 216; // max-w-[200px] + border/padding
            const flipUp =
              window.innerHeight -
                coords.bottom <
              menuH;
            setPasteSelectedIndex(0);
            setPasteInfo({
              url: pastedText,
              from: selection.from,
              to:
                selection.from +
                pastedText.length,
              x: Math.min(
                coords.left,
                window.innerWidth -
                  menuW -
                  8
              ),
              y: flipUp
                ? Math.max(
                    4,
                    coords.top -
                      menuH -
                      4
                  )
                : coords.bottom + 8
            });
          } catch (e) {
            setPasteSelectedIndex(0);
            setPasteInfo({
              url: pastedText,
              from: selection.from,
              to:
                selection.from +
                pastedText.length,
              x:
                window.innerWidth / 2 -
                150,
              y: window.innerHeight / 2
            });
          }
          return true;
        }

        return false;
      },
      handleDrop: (
        _view,
        event,
        _slice,
        moved
      ) => {
        if (moved) return false;
        const files =
          event.dataTransfer?.files;
        if (
          !files ||
          files.length === 0
        )
          return false;
        let hasImage = false;
        for (
          let i = 0;
          i < files.length;
          i++
        ) {
          if (
            files[i].type.indexOf(
              "image"
            ) !== -1
          ) {
            hasImage = true;
            uploadImageAndInsert(
              files[i]
            );
          }
        }
        return hasImage;
      },
      handleClick: (
        view,
        _pos,
        event
      ) => {
        let target =
          event.target as HTMLElement | null;
        while (
          target &&
          target !== view.dom
        ) {
          if (target.nodeName === "A") {
            const href =
              target.getAttribute(
                "href"
              );
            if (href) {
              event.preventDefault();
              event.stopPropagation();
              if (
                href.startsWith(
                  "http://"
                ) ||
                href.startsWith(
                  "https://"
                )
              ) {
                window.open(
                  href,
                  "_blank",
                  "noopener,noreferrer"
                );
              } else {
                onSelectFile?.(href);
              }
              return true;
            }
          }
          if (
            target.nodeName === "IMG"
          ) {
            // Skip images inside the emoji picker, callout header, or the
            // blocked-embed screenshot fallback — that last one is a
            // read-only preview of an external page, not editable content,
            // and its src is a /api/screenshot?url=... proxy URL that this
            // modal isn't equipped to handle (it isn't a plain asset URL).
            if (
              target.closest(
                ".epr-main"
              ) ||
              target.closest(
                "[data-callout]"
              ) ||
              target.closest(
                "[data-embed-screenshot]"
              )
            ) {
              target =
                target.parentElement;
              continue;
            }
            const src =
              target.getAttribute(
                "src"
              );
            if (src) {
              event.preventDefault();
              event.stopPropagation();
              setEditingImageSrc(src);
              return true;
            }
          }
          target = target.parentElement;
        }
        return false;
      },
      handleKeyDown: (_view, event) => {
        // If link paste choices popup is open, Up/Down cycle through its 3
        // options (Inline Link / Bookmark Card / Embed) and Enter picks the
        // highlighted one; any other content keypress dismisses it instead.
        if (pasteInfoRef.current) {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setPasteSelectedIndex(
              (prev) => (prev + 1) % 3
            );
            return true;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setPasteSelectedIndex(
              (prev) => (prev + 2) % 3
            );
            return true;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            const idx =
              pasteSelectedIndexRef.current;
            if (idx === 1)
              handleToastConvert("bookmark");
            else if (idx === 2)
              handleToastConvert("embed");
            else setPasteInfo(null);
            return true;
          }
          if (
            ![
              "Control",
              "Shift",
              "Alt",
              "Meta"
            ].includes(event.key)
          ) {
            setPasteInfo(null);
          }
        }

        if (commandActiveRef.current) {
          const filtered =
            getFilteredCommands();
          if (filtered.length > 0) {
            if (
              event.key === "ArrowDown"
            ) {
              event.preventDefault();
              setSelectedIndex(
                (prev) =>
                  (prev + 1) %
                  filtered.length
              );
              return true;
            }
            if (
              event.key === "ArrowUp"
            ) {
              event.preventDefault();
              setSelectedIndex(
                (prev) =>
                  (prev -
                    1 +
                    filtered.length) %
                  filtered.length
              );
              return true;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              executeCommand(
                filtered[
                  selectedIndexRef
                    .current
                ].id
              );
              return true;
            }
            if (
              event.key === "Escape"
            ) {
              event.preventDefault();
              setCommandActive(false);
              return true;
            }
          }
        }

        if (mentionActiveRef.current) {
          const filtered =
            getFilteredMentions();
          if (filtered.length > 0) {
            if (
              event.key === "ArrowDown"
            ) {
              event.preventDefault();
              setMentionSelectedIndex(
                (prev) =>
                  (prev + 1) %
                  filtered.length
              );
              return true;
            }
            if (
              event.key === "ArrowUp"
            ) {
              event.preventDefault();
              setMentionSelectedIndex(
                (prev) =>
                  (prev -
                    1 +
                    filtered.length) %
                  filtered.length
              );
              return true;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              executeMention(
                filtered[
                  mentionSelectedIndexRef
                    .current
                ]
              );
              return true;
            }
            if (
              event.key === "Escape"
            ) {
              event.preventDefault();
              setMentionActive(false);
              return true;
            }
          }
        }

        if (emojiActiveRef.current) {
          const filtered =
            getFilteredEmojis();
          if (filtered.length > 0) {
            if (
              event.key === "ArrowDown"
            ) {
              event.preventDefault();
              setEmojiSelectedIndex(
                (prev) =>
                  (prev + 1) %
                  filtered.length
              );
              return true;
            }
            if (
              event.key === "ArrowUp"
            ) {
              event.preventDefault();
              setEmojiSelectedIndex(
                (prev) =>
                  (prev -
                    1 +
                    filtered.length) %
                  filtered.length
              );
              return true;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              executeEmoji(
                filtered[
                  emojiSelectedIndexRef
                    .current
                ].char
              );
              return true;
            }
            if (
              event.key === "Escape"
            ) {
              event.preventDefault();
              setEmojiActive(false);
              return true;
            }
            if (event.key === " ") {
              setEmojiActive(false);
            }
          }
        }

        return false;
      }
    },
    onUpdate: () => {
      triggerAutoSave();
    },
    onSelectionUpdate: () => {
      // Don't auto-dismiss in selectionUpdate as that is triggered by editor events
    }
  });

  // Checking a task item moves it above every unchecked sibling in its list
  // (top-level or nested), so completed tasks never sit in the middle of an
  // active list. Listens on the bubble phase so it runs after TaskItem's own
  // node view has already committed the `checked` attribute change.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const onChange = (event: Event) => {
      const target = event.target as HTMLElement;
      if (
        !(target instanceof HTMLInputElement) ||
        target.type !== "checkbox"
      )
        return;
      const li = target.closest("li");
      if (
        !li ||
        !dom.contains(li) ||
        li.parentElement?.getAttribute("data-type") !== "taskList"
      )
        return;

      const pos = editor.view.posAtDOM(li, 0);
      const $pos = editor.state.doc.resolve(pos);
      // $pos resolves to just inside the taskItem (before its first child
      // paragraph), so the taskItem is $pos.depth and its taskList parent is
      // one level up.
      const listDepth = $pos.depth - 1;
      if (listDepth < 0) return;
      const taskList = $pos.node(listDepth);
      if (taskList.type.name !== "taskList") return;
      const listPos = $pos.before(listDepth);

      const children: any[] = [];
      taskList.forEach((child) => children.push(child));
      const checkedItems = children.filter((c) => c.attrs.checked);
      const uncheckedItems = children.filter((c) => !c.attrs.checked);
      const desired = [...checkedItems, ...uncheckedItems];
      const alreadySorted = desired.every((n, i) => n === children[i]);
      if (alreadySorted) return;

      const newTaskList = taskList.type.create(
        taskList.attrs,
        desired,
        taskList.marks
      );
      const tr = editor.state.tr.replaceWith(
        listPos,
        listPos + taskList.nodeSize,
        newTaskList
      );
      editor.view.dispatch(tr);
    };
    dom.addEventListener("change", onChange);
    return () => dom.removeEventListener("change", onChange);
  }, [editor]);

  // Synchronize state values to refs on every render
  useEffect(() => {
    commandActiveRef.current =
      commandActive;
    selectedIndexRef.current =
      selectedIndex;
    commandQueryRef.current =
      commandQuery;

    mentionActiveRef.current =
      mentionActive;
    mentionSelectedIndexRef.current =
      mentionSelectedIndex;
    mentionQueryRef.current =
      mentionQuery;

    emojiActiveRef.current =
      emojiActive;
    emojiSelectedIndexRef.current =
      emojiSelectedIndex;
    emojiQueryRef.current = emojiQuery;

    pasteSelectedIndexRef.current =
      pasteSelectedIndex;

    autosaveDelayRef.current =
      autosaveDelay;
    onSaveRef.current = onSave;
    onTitleChangeRef.current =
      onTitleChange;
  });

  useEffect(() => {
    if (!commandActive) return;
    const item =
      commandListRef.current?.querySelector<HTMLElement>(
        '[data-cmd-idx="' +
          selectedIndex +
          '"]'
      );
    item?.scrollIntoView({
      block: "nearest"
    });
  }, [selectedIndex, commandActive]);

  // Floating Table Controls coordinates state — drives ONLY the cell
  // background color button/popover now (selection-driven, since color
  // needs to apply to whatever cell(s) are actually selected, which a
  // hover point alone can't tell us for a multi-cell drag-selection).
  const [
    activeTableRect,
    setActiveTableRect
  ] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
    cellTop: number;
    cellLeft: number;
    cellWidth: number;
    cellHeight: number;
  } | null>(null);

  // Row/column insert+delete controls — Notion/ClickUp-style gutters that
  // live in a reserved margin along the table's left (rows) and top
  // (columns) edges, plus thin "add" strips along the bottom/right. They
  // only appear when the pointer is actually in one of those margins (not
  // when hovering/typing/selecting inside the table body), and since the
  // rendered buttons occupy exactly the same screen region the hit-test
  // checks, there's no gap for the pointer to cross where they'd vanish.
  const TABLE_GUTTER_SIZE = 16;
  const [tableGutter, setTableGutter] = useState<{
    tableEl: HTMLElement;
    tableRect: { top: number; left: number; width: number; height: number };
    rows: { top: number; height: number }[];
    cols: { left: number; width: number }[];
    hoverRow: number | null;
    hoverCol: number | null;
    hoverAddRow: boolean;
    hoverAddCol: boolean;
  } | null>(null);
  const [tableGutterMenu, setTableGutterMenu] = useState<{
    type: "row" | "col";
    index: number;
    tableEl: HTMLElement;
    top: number;
    left: number;
  } | null>(null);

  const computeTableLayout = (tableEl: HTMLElement) => {
    const table = tableEl as HTMLTableElement;
    const tableRect = table.getBoundingClientRect();
    const rows = Array.from(table.rows).map((r) => {
      const rr = r.getBoundingClientRect();
      return { top: rr.top, height: rr.height };
    });
    const firstRow = table.rows[0];
    const cols = firstRow
      ? Array.from(firstRow.cells).map((c) => {
          const cr = c.getBoundingClientRect();
          return { left: cr.left, width: cr.width };
        })
      : [];
    return {
      tableRect: {
        top: tableRect.top,
        left: tableRect.left,
        width: tableRect.width,
        height: tableRect.height
      },
      rows,
      cols
    };
  };

  // Moves the selection into a specific row/column of a table (via an
  // anchor cell) and runs a table command against it — this is what makes
  // insert/delete work on ANY row or column, not just wherever the text
  // caret currently happens to be.
  const runTableIndexCommand = (
    tableEl: HTMLElement,
    type: "row" | "col",
    index: number,
    run: (chain: any) => any
  ) => {
    if (!editor) return;
    const table = tableEl as HTMLTableElement;
    const row = type === "row" ? table.rows[index] : table.rows[0];
    const cell = row ? (type === "row" ? row.cells[0] : row.cells[index]) : null;
    if (!cell) return;
    try {
      const pos = editor.view.posAtDOM(cell, 0);
      run(editor.chain().focus().setTextSelection(pos)).run();
    } catch (e) {
      console.error("Table command failed", e);
    }
  };

  const updateTableRect = () => {
    if (!editor || !editor.isFocused) {
      setActiveTableRect(null);
      return;
    }

    const selection =
      window.getSelection();
    if (
      !selection ||
      selection.rangeCount === 0
    ) {
      setActiveTableRect(null);
      return;
    }

    try {
      const range =
        selection.getRangeAt(0);
      const cell =
        range.startContainer
          .nodeType === 3
          ? range.startContainer.parentElement?.closest(
              "td, th"
            )
          : (
              range.startContainer as HTMLElement
            )?.closest?.("td, th");

      const table =
        cell?.closest("table");
      if (table && cell) {
        const rect =
          table.getBoundingClientRect();
        const cellRect = (
          cell as HTMLElement
        ).getBoundingClientRect();
        setActiveTableRect({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          cellTop: cellRect.top,
          cellLeft: cellRect.left,
          cellWidth: cellRect.width,
          cellHeight: cellRect.height
        });
      } else {
        setActiveTableRect(null);
      }
    } catch (e) {
      setActiveTableRect(null);
    }
  };

  // Sync table selection & scroll updates
  useEffect(() => {
    if (!editor) return;

    const handleUpdate = () => {
      updateTableRect();
    };

    const handleUpdateDelayed = () => {
      setTimeout(handleUpdate, 10);
    };

    editor.on(
      "selectionUpdate",
      handleUpdateDelayed
    );
    editor.on(
      "focus",
      handleUpdateDelayed
    );
    editor.on(
      "blur",
      handleUpdateDelayed
    );
    // "update" fires on every transaction — typed content that changes a
    // row's height, or a column dragged wider/narrower via the table's
    // built-in resize handles, are both transactions but neither one is a
    // selectionUpdate/focus/blur/scroll/resize, so without this the color
    // button's position would silently drift out of sync with the table
    // until one of those other events happened to fire.
    editor.on(
      "update",
      handleUpdateDelayed
    );

    window.addEventListener(
      "scroll",
      handleUpdate,
      true
    );
    window.addEventListener(
      "resize",
      handleUpdate
    );

    return () => {
      editor.off(
        "selectionUpdate",
        handleUpdateDelayed
      );
      editor.off(
        "focus",
        handleUpdateDelayed
      );
      editor.off(
        "blur",
        handleUpdateDelayed
      );
      editor.off(
        "update",
        handleUpdateDelayed
      );
      window.removeEventListener(
        "scroll",
        handleUpdate,
        true
      );
      window.removeEventListener(
        "resize",
        handleUpdate
      );
    };
  }, [editor]);

  // Row/column gutter hover tracking. Scoped to `window` (not the editor's
  // own DOM) because the gutter buttons render just *outside* the table's
  // DOM subtree, in the reserved margin around it — if we only listened on
  // the editor's dom, the pointer would "leave" as soon as it crossed into
  // that margin. The hit-test regions below are defined to exactly match
  // where the gutter buttons are rendered, so there's never a gap between
  // "still hovering" and "button is there".
  useEffect(() => {
    if (!editor) return;

    const handleMove = (e: MouseEvent) => {
      // Left button held = the user is drag-selecting cells/text, not
      // looking to manage rows/columns — don't clutter that with gutters.
      if (e.buttons & 1) {
        setTableGutter(null);
        return;
      }
      const dom = editor.view.dom;
      const tables = Array.from(dom.querySelectorAll("table")) as HTMLElement[];
      const x = e.clientX;
      const y = e.clientY;

      for (const tableEl of tables) {
        const { tableRect, rows, cols } = computeTableLayout(tableEl);
        const inRowGutter =
          x >= tableRect.left - TABLE_GUTTER_SIZE &&
          x < tableRect.left &&
          y >= tableRect.top &&
          y <= tableRect.top + tableRect.height;
        const inColGutter =
          y >= tableRect.top - TABLE_GUTTER_SIZE &&
          y < tableRect.top &&
          x >= tableRect.left &&
          x <= tableRect.left + tableRect.width;
        const inAddRow =
          y >= tableRect.top + tableRect.height &&
          y < tableRect.top + tableRect.height + TABLE_GUTTER_SIZE &&
          x >= tableRect.left &&
          x <= tableRect.left + tableRect.width;
        const inAddCol =
          x >= tableRect.left + tableRect.width &&
          x < tableRect.left + tableRect.width + TABLE_GUTTER_SIZE &&
          y >= tableRect.top &&
          y <= tableRect.top + tableRect.height;

        if (!inRowGutter && !inColGutter && !inAddRow && !inAddCol) continue;

        const hoverRow = inRowGutter
          ? rows.findIndex((r) => y >= r.top && y < r.top + r.height)
          : null;
        const hoverCol = inColGutter
          ? cols.findIndex((c) => x >= c.left && x < c.left + c.width)
          : null;

        setTableGutter({
          tableEl,
          tableRect,
          rows,
          cols,
          hoverRow: hoverRow === -1 ? null : hoverRow,
          hoverCol: hoverCol === -1 ? null : hoverCol,
          hoverAddRow: inAddRow,
          hoverAddCol: inAddCol
        });
        return;
      }
      setTableGutter(null);
    };

    // Typing shouldn't leave stale gutters/menus lingering over the table.
    const handleKeydown = () => {
      setTableGutter(null);
      setTableGutterMenu(null);
    };
    const handleScrollOrResize = () => setTableGutter(null);

    window.addEventListener("mousemove", handleMove);
    editor.view.dom.addEventListener("keydown", handleKeydown);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      editor.view.dom.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [editor]);

  // Watch for text patterns (e.g. typing / or @)
  useEffect(() => {
    if (!editor) return;

    const handleUpdate = () => {
      const { selection } =
        editor.state;
      const textBeforeCursor =
        editor.state.doc.textBetween(
          Math.max(
            0,
            selection.from - 20
          ),
          selection.from,
          "\n"
        );

      const slashMatch =
        textBeforeCursor.match(
          /(?:^|\s)\/([a-zA-Z0-9]*)$/
        );
      const mentionMatch =
        textBeforeCursor.match(
          /(?:^|\s)@([a-zA-Z0-9\s-]*)$/
        );
      const emojiMatch =
        textBeforeCursor.match(
          /(?:^|\s):([a-zA-Z0-9_+-]*)$/
        );

      if (slashMatch) {
        setCommandActive(true);
        setCommandQuery(slashMatch[1]);
        setSelectedIndex(0);
        setMentionActive(false);
        setEmojiActive(false);
        try {
          const coords =
            editor.view.coordsAtPos(
              selection.from
            );
          const menuH = 300; // max-h-72 (288px) + header
          const menuW = 264; // w-64 (256px) + border
          const flipUp =
            window.innerHeight -
              coords.bottom <
            menuH;
          setCommandCoords({
            top: flipUp
              ? Math.max(
                  4,
                  coords.top - menuH - 4
                )
              : coords.bottom + 8,
            left: Math.min(
              coords.left,
              window.innerWidth -
                menuW -
                8
            )
          });
        } catch (e) {}
      } else if (mentionMatch) {
        setMentionActive(true);
        setMentionQuery(
          mentionMatch[1]
        );
        setMentionSelectedIndex(0);
        setCommandActive(false);
        setEmojiActive(false);
        try {
          const coords =
            editor.view.coordsAtPos(
              selection.from
            );
          const menuH = 300;
          const menuW = 328; // w-80 (320px) + border
          const flipUp =
            window.innerHeight -
              coords.bottom <
            menuH;
          setMentionCoords({
            top: flipUp
              ? Math.max(
                  4,
                  coords.top - menuH - 4
                )
              : coords.bottom + 8,
            left: Math.min(
              coords.left,
              window.innerWidth -
                menuW -
                8
            )
          });
        } catch (e) {}
      } else if (emojiMatch) {
        setEmojiActive(true);
        setEmojiQuery(emojiMatch[1]);
        setCommandActive(false);
        setMentionActive(false);
        setEmojiSelectedIndex(0);
        try {
          const coords =
            editor.view.coordsAtPos(
              selection.from
            );
          const menuH = 460; // EmojiPicker default height
          const menuW = 360;
          const flipUp =
            window.innerHeight -
              coords.bottom <
            menuH;
          setEmojiCoords({
            top: flipUp
              ? Math.max(
                  4,
                  coords.top - menuH - 4
                )
              : coords.bottom + 8,
            left: Math.min(
              coords.left,
              window.innerWidth -
                menuW -
                8
            )
          });
        } catch (e) {}
      } else {
        setCommandActive(false);
        setMentionActive(false);
        setEmojiActive(false);
      }
    };

    editor.on(
      "selectionUpdate",
      handleUpdate
    );
    editor.on("update", handleUpdate);
    return () => {
      editor.off(
        "selectionUpdate",
        handleUpdate
      );
      editor.off(
        "update",
        handleUpdate
      );
    };
  }, [editor]);

  // The slash-menu position above is computed with a worst-case menu height
  // (so a full, unfiltered list never overflows the screen). Once the list
  // is actually rendered — e.g. filtered down to a single "/embed" result —
  // its real height is much smaller, so re-measure and snap the popup back
  // next to the cursor before the browser paints (no visible jump).
  useLayoutEffect(() => {
    if (!commandActive || !editor)
      return;
    const el = commandListRef.current;
    if (!el) return;
    try {
      const coords =
        editor.view.coordsAtPos(
          editor.state.selection.from
        );
      const rect =
        el.getBoundingClientRect();
      const flipUp =
        window.innerHeight -
          coords.bottom <
        rect.height;
      setCommandCoords({
        top: flipUp
          ? Math.max(
              4,
              coords.top -
                rect.height -
                4
            )
          : coords.bottom + 8,
        left: Math.min(
          coords.left,
          window.innerWidth -
            rect.width -
            8
        )
      });
    } catch (e) {}
  }, [
    commandActive,
    commandQuery,
    editor
  ]);

  // Bubble menu: show a floating toolbar above selected text
  useEffect(() => {
    if (!editor) return;

    let blurTimer: ReturnType<
      typeof setTimeout
    > | null = null;

    const updateBubble = () => {
      if (blurTimer)
        clearTimeout(blurTimer);

      const { empty } =
        editor.state.selection;
      if (
        empty ||
        isNodeSelection(
          editor.state.selection
        ) ||
        editor.isActive("codeBlock") ||
        editor.isActive("code")
      ) {
        setBubbleVisible(false);
        return;
      }

      try {
        const domSel =
          window.getSelection();
        if (
          !domSel ||
          domSel.rangeCount === 0
        ) {
          setBubbleVisible(false);
          return;
        }
        const rect = domSel
          .getRangeAt(0)
          .getBoundingClientRect();
        if (
          !rect.width &&
          !rect.height
        ) {
          setBubbleVisible(false);
          return;
        }

        // GAP: visual breathing room between the selection and the bubble —
        // was 8px, which read as "sitting right on top of the text" once
        // the flipped-below case (limited room above) put the bubble that
        // close underneath instead of above it.
        const GAP = 14;
        const { width: BUBBLE_W, height: BUBBLE_H } =
          bubbleSizeRef.current;
        const centerX =
          rect.left + rect.width / 2;
        const left = Math.max(
          8,
          Math.min(
            centerX - BUBBLE_W / 2,
            window.innerWidth -
              BUBBLE_W -
              8
          )
        );
        const rawTop =
          rect.top >= BUBBLE_H + GAP + 8
            ? rect.top - BUBBLE_H - GAP
            : rect.bottom + GAP;
        const top = Math.max(
          8,
          Math.min(
            rawTop,
            window.innerHeight -
              BUBBLE_H -
              8
          )
        );

        setBubbleCoords({ top, left });
        setBubbleVisible(true);
        // The very first time this shows (or if button count/width ever
        // changes), bubbleSizeRef still holds the fallback estimate — measure
        // the real rendered size a frame later and immediately reposition
        // with it, rather than trusting a hardcoded constant that's already
        // been caught drifting from reality once.
        requestAnimationFrame(() => {
          const el = bubbleRef.current;
          if (!el) return;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) return;
          if (
            Math.abs(r.width - bubbleSizeRef.current.width) < 1 &&
            Math.abs(r.height - bubbleSizeRef.current.height) < 1
          ) {
            return;
          }
          bubbleSizeRef.current = { width: r.width, height: r.height };
          updateBubble();
        });
      } catch {
        setBubbleVisible(false);
      }
    };

    const hideBubble = () => {
      blurTimer = setTimeout(
        () => setBubbleVisible(false),
        180
      );
    };
    const cancelHide = () => {
      if (blurTimer)
        clearTimeout(blurTimer);
    };

    editor.on(
      "selectionUpdate",
      updateBubble
    );
    editor.on("update", updateBubble);
    editor.on("blur", hideBubble);
    editor.on("focus", cancelHide);

    return () => {
      editor.off(
        "selectionUpdate",
        updateBubble
      );
      editor.off(
        "update",
        updateBubble
      );
      editor.off("blur", hideBubble);
      editor.off("focus", cancelHide);
      if (blurTimer)
        clearTimeout(blurTimer);
    };
  }, [editor]);

  // Wire image click callback into module-level ref so ImageWithCaption node view can call it
  useEffect(() => {
    _imageClickRef.current =
      setEditingImageSrc;
  }, []);

  // Apply font size via data-fontsize attribute on the editor wrapper (CSS handles the rest)
  const editorWrapperRef =
    useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!editorWrapperRef.current)
      return;
    editorWrapperRef.current.setAttribute(
      "data-fontsize",
      editorFontSize
    );
  }, [editorFontSize]);

  // Word count
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const text =
        editor.state.doc.textContent;
      setWordCount(
        text.trim()
          ? text.trim().split(/\s+/)
              .length
          : 0
      );
    };
    update();
    editor.on("update", update);
    return () => {
      editor.off("update", update);
    };
  }, [editor]);

  // TOC sidebar headings (live)
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const hs: {
        level: number;
        text: string;
        pos: number;
      }[] = [];
      editor.state.doc.descendants(
        (node: any, pos: number) => {
          if (
            node.type.name === "heading"
          )
            hs.push({
              level: node.attrs.level,
              text: node.textContent,
              pos
            });
        }
      );
      setTocHeadings(hs);
    };
    update();
    editor.on("update", update);
    return () => {
      editor.off("update", update);
    };
  }, [editor]);

  // Backlinks: fetch when panel opens or file changes
  const fetchBacklinks =
    useCallback(() => {
      if (!filePath) return;
      setBacklinksLoading(true);
      fetch(
        `${API_BASE}/api/backlinks?path=${encodeURIComponent(filePath)}`
      )
        .then((r) => r.json())
        .then((data) =>
          setBacklinks(data || [])
        )
        .catch(() => setBacklinks([]))
        .finally(() =>
          setBacklinksLoading(false)
        );
    }, [filePath]);

  useEffect(() => {
    if (!backlinksOpen) return;
    fetchBacklinks();
  }, [backlinksOpen, fetchBacklinks]);

  // Drag handle click handler (extension manages DOM placement; we just add click listener)
  useEffect(() => {
    const el = dragHandleEl.current;
    el.className = "bf-drag-handle";
    el.innerHTML = `<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="3" cy="3.5"  r="1.3"/>
      <circle cx="7" cy="3.5"  r="1.3"/>
      <circle cx="3" cy="8"    r="1.3"/>
      <circle cx="7" cy="8"    r="1.3"/>
      <circle cx="3" cy="12.5" r="1.3"/>
      <circle cx="7" cy="12.5" r="1.3"/>
    </svg>`;
    const onClick = () => {
      const data = dragNodeRef.current;
      if (!data || !data.editor) return;
      const domEl =
        data.editor.view.nodeDOM(
          data.pos
        );
      if (
        domEl instanceof HTMLElement
      ) {
        const rect =
          domEl.getBoundingClientRect();
        setBlockMenu({
          open: true,
          coords: {
            top: rect.top,
            left: rect.left - 8
          },
          pos: data.pos,
          submenu: null
        });
      }
    };
    el.addEventListener(
      "click",
      onClick
    );
    return () => {
      el.removeEventListener(
        "click",
        onClick
      );
    };
  }, []);

  // Close block menu and context menu on outside click / Escape
  useEffect(() => {
    if (
      !blockMenu?.open &&
      !contextMenu?.open
    )
      return;
    const close = (e: MouseEvent) => {
      const t = e.target as Element;
      if (
        !t.closest?.(
          "[data-block-menu]"
        ) &&
        !t.closest?.(
          "[data-context-menu]"
        )
      ) {
        setBlockMenu(null);
        setContextMenu(null);
      }
    };
    const onKey = (
      e: KeyboardEvent
    ) => {
      if (e.key === "Escape") {
        setBlockMenu(null);
        setContextMenu(null);
      }
    };
    document.addEventListener(
      "mousedown",
      close
    );
    document.addEventListener(
      "keydown",
      onKey
    );
    return () => {
      document.removeEventListener(
        "mousedown",
        close
      );
      document.removeEventListener(
        "keydown",
        onKey
      );
    };
  }, [
    blockMenu?.open,
    contextMenu?.open
  ]);

  // Link preview: hover over internal [[page]] links
  useEffect(() => {
    const editorEl =
      document.querySelector(
        ".ProseMirror"
      );
    if (!editorEl || !editor) return;
    const onOver = (e: Event) => {
      const target = (e as MouseEvent)
        .target as HTMLElement;
      const anchor = target.closest?.(
        "a"
      ) as HTMLAnchorElement | null;
      if (!anchor) {
        clearPreview();
        return;
      }
      const href =
        anchor.getAttribute("href");
      if (
        !href ||
        href.startsWith("http://") ||
        href.startsWith("https://")
      ) {
        clearPreview();
        return;
      }
      if (linkPreviewTimer.current)
        clearTimeout(
          linkPreviewTimer.current
        );
      linkPreviewTimer.current =
        setTimeout(async () => {
          try {
            const res = await fetch(
              `${API_BASE}/api/file?path=${encodeURIComponent(href)}`
            );
            if (!res.ok) return;
            const data =
              await res.json();
            let text: string =
              data.content || "";
            // Strip YAML frontmatter
            if (
              text.startsWith("---")
            ) {
              const end = text.indexOf(
                "\n---",
                3
              );
              if (end !== -1)
                text = text.slice(
                  end + 4
                );
            }
            // Extract title from first H1, fall back to anchor text
            const h1 =
              text.match(/^#\s+(.+)/m);
            const previewTitle = h1
              ? h1[1].trim()
              : anchor.textContent ||
                href;
            // Collect first 3 non-empty, non-heading, non-metadata lines
            const lines = text
              .split("\n")
              .map((l: string) =>
                l.trim()
              )
              .filter(
                (l: string) =>
                  l &&
                  !l.startsWith("#") &&
                  !l.startsWith("!") &&
                  l.length > 15
              )
              .slice(0, 3);
            const rect =
              anchor.getBoundingClientRect();
            setLinkPreview({
              href,
              title: previewTitle,
              excerpt: lines
                .join(" ")
                .slice(0, 200),
              coords: {
                top: rect.bottom + 6,
                left: rect.left
              }
            });
          } catch {
            /* ignore */
          }
        }, 400);
    };
    const clearPreview = () => {
      if (linkPreviewTimer.current)
        clearTimeout(
          linkPreviewTimer.current
        );
      setLinkPreview(null);
    };
    editorEl.addEventListener(
      "mouseover",
      onOver
    );
    editorEl.addEventListener(
      "mouseout",
      clearPreview
    );
    return () => {
      editorEl.removeEventListener(
        "mouseover",
        onOver
      );
      editorEl.removeEventListener(
        "mouseout",
        clearPreview
      );
    };
  }, [editor]);

  // Right-click context menu on editor
  useEffect(() => {
    const editorEl =
      document.querySelector(
        ".ProseMirror"
      );
    if (!editorEl || !editor) return;
    const onContextMenu = (
      e: Event
    ) => {
      const me = e as MouseEvent;
      me.preventDefault();
      const coords =
        editor.view.posAtCoords({
          left: me.clientX,
          top: me.clientY
        });
      const pos = coords?.pos ?? 0;
      setContextMenu({
        open: true,
        coords: {
          top: me.clientY,
          left: me.clientX
        },
        pos
      });
    };
    editorEl.addEventListener(
      "contextmenu",
      onContextMenu
    );
    return () => {
      editorEl.removeEventListener(
        "contextmenu",
        onContextMenu
      );
    };
  }, [editor]);

  // Track initial content updates (switching files or external non-focused updates)
  useEffect(() => {
    if (
      editor &&
      initialContent !== undefined
    ) {
      const fileChanged =
        lastFilePathRef.current !==
        filePath;
      const contentChangedExternally =
        initialContent !==
        lastSavedContentRef.current;

      if (fileChanged) {
        lastFilePathRef.current =
          filePath;
        // lastSavedContentRef tracks the full on-disk body (with its leading
        // # Title line, matching what the parent's initialContent prop and
        // executeAutoSave's saved markdown both contain) so external-change
        // detection above keeps working — but the title itself is driven by
        // the Title page attribute now, not this line, so it's stripped
        // before ever reaching ProseMirror. See stripLeadingTitleH1.
        lastSavedContentRef.current =
          initialContent;
        const html =
          getHTMLFromMarkdown(
            stripLeadingTitleH1(
              initialContent
            )
          );
        // emitUpdate: false — this is a programmatic content LOAD, not a
        // user edit. Without this, it fires the same onUpdate->
        // triggerAutoSave() path as real typing, scheduling a debounced
        // autosave. That autosave re-prepends the H1 from
        // frontMatterTitleRef.current, which — right after a rename, where
        // filePath updates a render or two before the frontMatter prop
        // catches up — can still be the OLD title, so it would silently
        // overwrite the just-renamed file's new title with the stale one.
        editor.commands.setContent(
          html,
          { emitUpdate: false }
        );
        setSaveStatus("saved");
        setRemoteConflict(false);
      } else if (
        contentChangedExternally &&
        !editor.isFocused
      ) {
        lastSavedContentRef.current =
          initialContent;
        const html =
          getHTMLFromMarkdown(
            stripLeadingTitleH1(
              initialContent
            )
          );
        editor.commands.setContent(
          html,
          { emitUpdate: false }
        );
        setSaveStatus("saved");
        setRemoteConflict(false);
      } else if (
        contentChangedExternally &&
        editor.isFocused
      ) {
        // Don't clobber active typing — but don't silently drop the update
        // either. lastSavedContentRef is deliberately left stale here, so
        // contentChangedExternally keeps evaluating true (and this banner
        // keeps showing) until the user explicitly reloads or dismisses it.
        setRemoteConflict(true);
      }

      if (historyOpen && fileChanged) {
        fetchHistory();
      }
    }
  }, [
    initialContent,
    filePath,
    editor,
    historyOpen
  ]);

  // Manually applies the latest on-disk content over the local editor,
  // discarding whatever's currently typed — the "Reload" side of the
  // remote-conflict banner. initialContent is already the fresh version by
  // the time this can be clicked (the parent's fetchFileContent ran as soon
  // as the SSE update arrived; only the ProseMirror doc itself was held
  // back while focused).
  const applyRemoteContent = () => {
    if (!editor) return;
    lastSavedContentRef.current = initialContent;
    const html = getHTMLFromMarkdown(
      stripLeadingTitleH1(initialContent)
    );
    editor.commands.setContent(html, {
      emitUpdate: false
    });
    setSaveStatus("saved");
    setRemoteConflict(false);
  };

  // Highlight search term when loading document from search results
  useEffect(() => {
    if (!editor || !highlightSearchTerm)
      return;

    console.log(
      "[SearchHighlight] Triggered highlight search for:",
      highlightSearchTerm
    );

    const t = setTimeout(() => {
      let foundPos = -1;
      editor.state.doc.descendants(
        (node, pos) => {
          if (
            node.isText &&
            node.text
          ) {
            const idx = node.text
              .toLowerCase()
              .indexOf(
                highlightSearchTerm.toLowerCase()
              );
            if (idx !== -1) {
              foundPos = pos + idx;
              console.log(
                "[SearchHighlight] Found match inside text node at pos:",
                pos,
                "idx:",
                idx,
                "text:",
                node.text
              );
              return false;
            }
          }
          return true;
        }
      );

      if (foundPos !== -1) {
        editor
          .chain()
          .focus()
          .setTextSelection({
            from: foundPos,
            to:
              foundPos +
              highlightSearchTerm.length
          })
          .scrollIntoView()
          .run();
        console.log(
          "[SearchHighlight] Applied text selection highlight range:",
          foundPos,
          "to",
          foundPos +
            highlightSearchTerm.length
        );
      } else {
        console.log(
          "[SearchHighlight] No matches found inside editor doc nodes."
        );
      }

      onClearSearchHighlight?.();
    }, 250);

    return () => clearTimeout(t);
  }, [
    editor,
    highlightSearchTerm,
    initialContent
  ]);

  // Fetch Version History snapshots
  const fetchHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/file/history?path=${encodeURIComponent(filePath)}`
      );
      if (!res.ok)
        throw new Error(
          "Failed to fetch history"
        );
      const data = await res.json();
      setHistoryList(data || []);
    } catch (e) {
      console.error(
        "Error fetching version history",
        e
      );
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Toggle history panel
  useEffect(() => {
    if (historyOpen) {
      fetchHistory();
    }
  }, [historyOpen, filePath]);

  // Auto-save debounce trigger
  const triggerAutoSave = () => {
    setSaveStatus("dirty");
    if (saveTimeoutRef.current) {
      clearTimeout(
        saveTimeoutRef.current
      );
    }
    saveTimeoutRef.current = setTimeout(
      () => {
        // The timer has now fired — clear the ref before anything else so the
        // unmount-flush check below can tell "nothing pending" (already saved)
        // apart from "a debounced save is still waiting." Without this, the
        // ref stays truthy forever after the first autosave, so every later
        // unmount would flush again — resaving to whatever path this file
        // had, including a path that a rename/move has since made stale.
        saveTimeoutRef.current = null;
        // Chain rather than call directly — see saveChainRef comment above.
        saveChainRef.current = saveChainRef.current.then(
          executeAutoSave
        );
      },
      autosaveDelayRef.current
    );
  };

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(
          saveTimeoutRef.current
        );
        // A debounced save was still pending when this page/card was navigated
        // away from (or closed) — flush it immediately instead of silently
        // dropping the edit. This instance is remounted per file (keyed by
        // path), so onSave/executeAutoSave here still target the right file.
        // Still chained: if a previous autosave's rename is mid-flight, this
        // flush must wait for it rather than racing it.
        saveChainRef.current = saveChainRef.current.then(
          executeAutoSave
        );
      }
    };
  }, []);

  const executeAutoSave = async () => {
    if (!editor) return;
    setSaveStatus("saving");
    const html = editor.getHTML();
    const bodyMarkdown =
      turndownService.turndown(html);
    // The title lives outside the ProseMirror doc now (see
    // stripLeadingTitleH1), so it has to be re-added here for the saved
    // file to keep its on-disk # Title line. Title changes themselves are
    // saved separately, via commitTitleChange → onTitleChange (the rename
    // flow) — never through this autosave path.
    const title =
      frontMatterTitleRef.current;
    const markdown = title
      ? `# ${title}\n\n${bodyMarkdown}`
      : bodyMarkdown;
    try {
      await onSaveRef.current(markdown);
      lastSavedContentRef.current =
        markdown;
      setSaveStatus("saved");

      if (historyOpen) {
        fetchHistory();
      }
    } catch (e) {
      console.error(
        "Auto-save error",
        e
      );
      setSaveStatus("dirty");
    }
  };

  const handleRollback = async (
    timestamp: number,
    skipConfirm = false
  ) => {
    if (
      !skipConfirm &&
      !(await confirmDialog(
        "Do you want to roll back the page to this version? Your current state will be saved as a backup snapshot.",
        {
          title: "Roll back version",
          confirmLabel: "Roll back"
        }
      ))
    ) {
      return;
    }
    setSaveStatus("saving");
    try {
      const res = await fetch(
        `${API_BASE}/api/file/rollback`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            path: filePath,
            timestamp
          })
        }
      );
      if (!res.ok)
        throw new Error(
          "Failed to rollback"
        );
      const data = await res.json();

      // data.content is the raw file (front matter + body) restored from the
      // snapshot — strip the front matter before rendering, otherwise it gets
      // typeset as literal body text (title/tags/attachments JSON and all).
      // The body itself may still carry a leading # Title line if the
      // snapshot predates this file's last save (or predates this feature
      // entirely) — strip it the same as any other load, so a rollback
      // can't reintroduce an editable/selectable title into the body.
      const { body } = splitFrontMatter(
        data.content
      );
      const html = getHTMLFromMarkdown(
        stripLeadingTitleH1(body)
      );
      lastSavedContentRef.current =
        body;
      editor.commands.setContent(html);
      setSaveStatus("saved");
      fetchHistory();
      setPreviewVersion(null);
    } catch (e) {
      console.error(
        "Rollback error",
        e
      );
      alertDialog(
        "Failed to rollback version."
      );
      setSaveStatus("dirty");
    }
  };

  interface SideBySideLine {
    left: {
      type:
        | "removed"
        | "unchanged"
        | "empty";
      text: string;
      lineNum: number | null;
    };
    right: {
      type:
        | "added"
        | "unchanged"
        | "empty";
      text: string;
      lineNum: number | null;
    };
  }

  const getSideBySideDiff = (
    current: string,
    snapshot: string
  ): SideBySideLine[] => {
    const currentLines =
      current.split("\n");
    const snapshotLines =
      snapshot.split("\n");
    const diff: SideBySideLine[] = [];
    let i = 0,
      j = 0;
    let currentLineNum = 1;
    let snapshotLineNum = 1;

    while (
      i < currentLines.length ||
      j < snapshotLines.length
    ) {
      if (
        i < currentLines.length &&
        j < snapshotLines.length
      ) {
        if (
          currentLines[i] ===
          snapshotLines[j]
        ) {
          diff.push({
            left: {
              type: "unchanged",
              text: currentLines[i],
              lineNum: currentLineNum++
            },
            right: {
              type: "unchanged",
              text: snapshotLines[j],
              lineNum: snapshotLineNum++
            }
          });
          i++;
          j++;
        } else {
          let foundMatch = false;
          for (let k = 1; k <= 5; k++) {
            if (
              i + k <
                currentLines.length &&
              currentLines[i + k] ===
                snapshotLines[j]
            ) {
              for (
                let m = 0;
                m < k;
                m++
              ) {
                diff.push({
                  left: {
                    type: "removed",
                    text: currentLines[
                      i + m
                    ],
                    lineNum:
                      currentLineNum++
                  },
                  right: {
                    type: "empty",
                    text: "",
                    lineNum: null
                  }
                });
              }
              i += k;
              foundMatch = true;
              break;
            }
            if (
              j + k <
                snapshotLines.length &&
              currentLines[i] ===
                snapshotLines[j + k]
            ) {
              for (
                let m = 0;
                m < k;
                m++
              ) {
                diff.push({
                  left: {
                    type: "empty",
                    text: "",
                    lineNum: null
                  },
                  right: {
                    type: "added",
                    text: snapshotLines[
                      j + m
                    ],
                    lineNum:
                      snapshotLineNum++
                  }
                });
              }
              j += k;
              foundMatch = true;
              break;
            }
          }
          if (!foundMatch) {
            diff.push({
              left: {
                type: "removed",
                text: currentLines[i],
                lineNum:
                  currentLineNum++
              },
              right: {
                type: "added",
                text: snapshotLines[j],
                lineNum:
                  snapshotLineNum++
              }
            });
            i++;
            j++;
          }
        }
      } else if (
        i < currentLines.length
      ) {
        diff.push({
          left: {
            type: "removed",
            text: currentLines[i],
            lineNum: currentLineNum++
          },
          right: {
            type: "empty",
            text: "",
            lineNum: null
          }
        });
        i++;
      } else if (
        j < snapshotLines.length
      ) {
        diff.push({
          left: {
            type: "empty",
            text: "",
            lineNum: null
          },
          right: {
            type: "added",
            text: snapshotLines[j],
            lineNum: snapshotLineNum++
          }
        });
        j++;
      }
    }
    return diff;
  };

  const handleLoadPreview = async (
    timestamp: number,
    date: string
  ) => {
    setIsPreviewLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/file/history/content?path=${encodeURIComponent(filePath)}&timestamp=${timestamp}`
      );
      if (!res.ok)
        throw new Error(
          "Failed to load snapshot content"
        );
      const data = await res.json();
      // initialContent (the left/current side of the diff) is already
      // front-matter-stripped body text — split this snapshot the same way
      // so the diff compares body against body instead of body against the
      // full raw file (which would show every front-matter field as a
      // spurious "added" line).
      setPreviewVersion({
        timestamp,
        date,
        content: splitFrontMatter(
          data.content || ""
        ).body
      });
    } catch (e) {
      console.error(
        "Error loading history snapshot content",
        e
      );
      alertDialog(
        "Failed to load snapshot content."
      );
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const parseAttachments = (): {
    name: string;
    url: string;
    size: number;
  }[] => {
    const raw =
      frontMatter?.attachments;
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  };

  const formatBytes = (
    bytes: number
  ) => {
    if (bytes < 1024)
      return `${bytes} B`;
    if (bytes < 1024 * 1024)
      return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Shared upload call for cover/attachment/pasted images — extracts the
  // server's specific error (e.g. the configured size limit) instead of
  // always surfacing a generic "Upload failed" regardless of the cause.
  const uploadFile = async (
    file: File
  ): Promise<{ url: string; originalUrl?: string }> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(
      `${API_BASE}/api/upload?notePath=${encodeURIComponent(filePath)}`,
      {
        method: "POST",
        body: formData
      }
    );
    if (!res.ok) {
      let message = "Upload failed.";
      try {
        const data = await res.json();
        if (data?.error) message = data.error;
      } catch {
        // Response wasn't JSON — keep the generic message.
      }
      throw new Error(message);
    }
    return res.json();
  };

  const uploadAttachment = async (
    file: File
  ) => {
    if (!onUpdateFrontMatter) return;
    setAttachmentUploading(true);
    try {
      const data = await uploadFile(file);
      const existing =
        parseAttachments();
      const updated = [
        ...existing,
        {
          name: file.name,
          url: data.url,
          size: file.size
        }
      ];
      await onUpdateFrontMatter({
        attachments:
          JSON.stringify(updated)
      });
    } catch (e) {
      console.error(
        "Failed to upload attachment",
        e
      );
      alertDialog(
        e instanceof Error
          ? e.message
          : "Failed to upload attachment."
      );
    } finally {
      setAttachmentUploading(false);
    }
  };

  const uploadCover = async (
    file: File
  ) => {
    if (!onUpdateFrontMatter) return;
    try {
      const data = await uploadFile(file);
      if (data.url)
        onUpdateFrontMatter({
          cover: data.url
        });
    } catch (e) {
      console.error(
        "Failed to upload cover",
        e
      );
      alertDialog(
        e instanceof Error
          ? e.message
          : "Failed to upload cover."
      );
    }
  };

  const removeAttachment = async (
    url: string
  ) => {
    if (!onUpdateFrontMatter) return;
    const updated =
      parseAttachments().filter(
        (a) => a.url !== url
      );
    await onUpdateFrontMatter({
      attachments:
        JSON.stringify(updated)
    });
  };

  // Keep ref current on every render so paste handler is never stale
  uploadAttachmentRef.current =
    uploadAttachment;

  const isImageAttachment = (
    url: string
  ) =>
    /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(
      url
    );

  const setCover = (url: string) =>
    onUpdateFrontMatter?.({
      cover: url
    });
  const removeCover = () =>
    onUpdateFrontMatter?.({
      cover: ""
    });

  // Shared helper — pull an image File out of clipboard items, regardless
  // of destination (attachment vs. cover). Clipboard image data (a real
  // screenshot/copied bitmap, as opposed to a copied file) lands in
  // `clipboardData.items`, not `.files` — `.files` is typically empty for
  // that case, so any paste handler built on `.files` alone silently
  // no-ops on the most common paste-an-image gesture.
  const extractImageFileFromClipboard = (
    items: DataTransferItemList
  ): File | null => {
    const imgItem = Array.from(
      items
    ).find((i) =>
      i.type.startsWith("image/")
    );
    if (!imgItem) return null;
    const blob = imgItem.getAsFile();
    if (!blob) return null;
    const ext =
      imgItem.type
        .split("/")[1]
        ?.split("+")[0] || "png";
    const ts = new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14);
    return new File(
      [blob],
      `clipboard_${ts}.${ext}`,
      { type: imgItem.type }
    );
  };

  // Attachment-panel paste — extract + upload as an attachment
  const pasteImageFromClipboard = (
    items: DataTransferItemList
  ) => {
    const file =
      extractImageFileFromClipboard(
        items
      );
    if (!file) return false;
    uploadAttachmentRef.current(file);
    return true;
  };

  // Document-level paste → upload image as attachment when focus is outside the editor body.
  // If focus is inside bf-properties (the attachments panel) we always handle it,
  // even if ProseMirror technically still holds focus from a previous interaction.
  useEffect(() => {
    if (!onUpdateFrontMatter) return;
    const handler = (
      e: ClipboardEvent
    ) => {
      const target =
        e.target as Element;
      const inProperties =
        target?.closest?.(
          ".bf-properties"
        );
      if (
        !inProperties &&
        target?.closest?.(
          ".ProseMirror"
        )
      )
        return;
      const items =
        e.clipboardData?.items;
      if (!items) return;
      if (
        pasteImageFromClipboard(items)
      )
        e.preventDefault();
    };
    document.addEventListener(
      "paste",
      handler
    );
    return () =>
      document.removeEventListener(
        "paste",
        handler
      );
  }, [filePath, onUpdateFrontMatter]);

  const uploadImageAndInsert = async (
    file: File
  ) => {
    try {
      const data = await uploadFile(file);
      if (data.url && editor) {
        editor
          .chain()
          .focus()
          .setImage({ src: data.url })
          .run();
      }
    } catch (e) {
      console.error(
        "Failed to upload pasted/dropped image",
        e
      );
      alertDialog(
        e instanceof Error
          ? e.message
          : "Failed to upload image to assets directory."
      );
    }
  };

  const getRelativePath = (
    url: string
  ) => {
    try {
      const parsed = new URL(
        url,
        window.location.origin
      );
      return parsed.pathname;
    } catch (e) {
      return url.startsWith("/")
        ? url
        : "/" + url;
    }
  };

  const handleImageSave = (
    newUrl: string
  ) => {
    if (!editor) return;

    const oldBaseUrl = getRelativePath(
      editingImageSrc || ""
    ).split("?")[0];
    // Preserve the cache-busting query string (?t=timestamp) so the browser fetches the updated image
    const parsedNew = (() => {
      try {
        const u = new URL(
          newUrl,
          window.location.origin
        );
        return u.pathname + u.search;
      } catch {
        return newUrl;
      }
    })();
    const newRelativeUrl = parsedNew;

    editor.state.doc.descendants(
      (node, pos) => {
        if (
          node.type.name === "image"
        ) {
          const nodeBaseUrl =
            getRelativePath(
              node.attrs.src
            ).split("?")[0];
          if (
            nodeBaseUrl === oldBaseUrl
          ) {
            editor.view.dispatch(
              editor.state.tr.setNodeMarkup(
                pos,
                undefined,
                {
                  ...node.attrs,
                  src: newRelativeUrl
                }
              )
            );
          }
        }
      }
    );

    // Trigger auto-save immediately to save modified markdown content
    executeAutoSave();
  };

  const handleInsertEmbed = () => {
    if (!editor) return;

    if (embedType === "url") {
      if (!embedUrl.trim()) {
        alertDialog(
          "Please enter a URL to embed."
        );
        return;
      }

      let finalSrc = embedUrl.trim();

      // Auto-convert standard YouTube watch URLs to embed URLs
      if (
        finalSrc.includes(
          "youtube.com/watch?v="
        )
      ) {
        const videoId = finalSrc
          .split("v=")[1]
          ?.split("&")[0];
        if (videoId) {
          finalSrc = `https://www.youtube.com/embed/${videoId}`;
        }
      } else if (
        finalSrc.includes("youtu.be/")
      ) {
        const videoId = finalSrc
          .split("youtu.be/")[1]
          ?.split("?")[0];
        if (videoId) {
          finalSrc = `https://www.youtube.com/embed/${videoId}`;
        }
      }

      editor
        .chain()
        .focus()
        .insertContent(
          `<iframe src="${finalSrc}"></iframe>`
        )
        .run();
    } else if (embedType === "drawio") {
      if (!selectedCanvasPath) {
        alertDialog(
          "Please select a canvas drawing to embed."
        );
        return;
      }

      const selectedFile = wsFiles.find(
        (f) =>
          f.path === selectedCanvasPath
      );
      const editorType =
        selectedFile?.frontMatter
          ?.editor || "excalidraw";

      if (editorType === "drawio") {
        editor
          .chain()
          .focus()
          .insertContent(
            `<drawio path="${selectedCanvasPath}">drawio-canvas</drawio>`
          )
          .run();
      } else {
        editor
          .chain()
          .focus()
          .insertContent(
            `<excalidraw path="${selectedCanvasPath}">excalidraw-canvas</excalidraw>`
          )
          .run();
      }
    } else if (
      embedType === "mindmap"
    ) {
      if (!selectedMindmapPath) {
        alertDialog(
          "Please select a mind map to embed."
        );
        return;
      }
      editor
        .chain()
        .focus()
        .insertContent(
          `<mindmap path="${selectedMindmapPath}">mindmap-embed</mindmap>`
        )
        .run();
    }

    setEmbedModalOpen(false);
    triggerAutoSave();
  };

  const getFilteredCommands = () => {
    const query =
      commandQuery.toLowerCase();
    return COMMANDS.filter(
      (cmd) =>
        cmd.label
          .toLowerCase()
          .includes(query) ||
        cmd.search
          .toLowerCase()
          .includes(query)
    );
  };

  const executeCommand = (
    cmdId: string
  ) => {
    if (!editor) return;

    const { selection } = editor.state;
    const queryLength =
      commandQuery.length + 1;

    editor
      .chain()
      .focus()
      .deleteRange({
        from:
          selection.from - queryLength,
        to: selection.from
      })
      .run();

    switch (cmdId) {
      case "h1":
        editor
          .chain()
          .focus()
          .toggleHeading({ level: 1 })
          .run();
        break;
      case "h2":
        editor
          .chain()
          .focus()
          .toggleHeading({ level: 2 })
          .run();
        break;
      case "h3":
        editor
          .chain()
          .focus()
          .toggleHeading({ level: 3 })
          .run();
        break;
      case "bullet":
        editor
          .chain()
          .focus()
          .toggleBulletList()
          .run();
        break;
      case "number":
        editor
          .chain()
          .focus()
          .toggleOrderedList()
          .run();
        break;
      case "task":
        editor
          .chain()
          .focus()
          .toggleTaskList()
          .run();
        break;
      case "quote":
        editor
          .chain()
          .focus()
          .toggleBlockquote()
          .run();
        break;
      case "toggle":
        editor
          .chain()
          .focus()
          .insertContent({
            type: "details",
            content: [
              {
                type: "detailsSummary",
                content: [
                  {
                    type: "text",
                    text: "Toggle"
                  }
                ]
              },
              {
                type: "detailsContent",
                content: [
                  { type: "paragraph" }
                ]
              }
            ]
          })
          .run();
        break;
      case "callout-note":
        editor
          .chain()
          .focus()
          .insertContent({
            type: "callout",
            attrs: {
              calloutEmoji: "info",
              calloutLabel: "Note",
              calloutColor: "#6366f1"
            },
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: " "
                  }
                ]
              }
            ]
          })
          .run();
        break;
      case "callout-tip":
        editor
          .chain()
          .focus()
          .insertContent({
            type: "callout",
            attrs: {
              calloutEmoji: "tip",
              calloutLabel: "Tip",
              calloutColor: "#10b981"
            },
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: " "
                  }
                ]
              }
            ]
          })
          .run();
        break;
      case "callout-warning":
        editor
          .chain()
          .focus()
          .insertContent({
            type: "callout",
            attrs: {
              calloutEmoji: "warning",
              calloutLabel: "Warning",
              calloutColor: "#f59e0b"
            },
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: " "
                  }
                ]
              }
            ]
          })
          .run();
        break;
      case "callout-danger":
        editor
          .chain()
          .focus()
          .insertContent({
            type: "callout",
            attrs: {
              calloutEmoji: "danger",
              calloutLabel: "Danger",
              calloutColor: "#ef4444"
            },
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: " "
                  }
                ]
              }
            ]
          })
          .run();
        break;
      case "callout-bug":
        editor
          .chain()
          .focus()
          .insertContent({
            type: "callout",
            attrs: {
              calloutEmoji: "bug",
              calloutLabel: "Bug",
              calloutColor: "#ec4899"
            },
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: " "
                  }
                ]
              }
            ]
          })
          .run();
        break;
      case "callout-todo":
        editor
          .chain()
          .focus()
          .insertContent({
            type: "callout",
            attrs: {
              calloutEmoji: "todo",
              calloutLabel: "Todo",
              calloutColor: "#06b6d4"
            },
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: " "
                  }
                ]
              }
            ]
          })
          .run();
        break;
      case "callout-missing":
        editor
          .chain()
          .focus()
          .insertContent({
            type: "callout",
            attrs: {
              calloutEmoji: "missing",
              calloutLabel: "Missing",
              calloutColor: "#ef4444"
            },
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: " "
                  }
                ]
              }
            ]
          })
          .run();
        break;
      case "callout-question":
        editor
          .chain()
          .focus()
          .insertContent({
            type: "callout",
            attrs: {
              calloutEmoji: "question",
              calloutLabel: "Question",
              calloutColor: "#22c55e"
            },
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: " "
                  }
                ]
              }
            ]
          })
          .run();
        break;
      case "callout-summary":
        editor
          .chain()
          .focus()
          .insertContent({
            type: "callout",
            attrs: {
              calloutEmoji: "summary",
              calloutLabel: "Summary",
              calloutColor: "#3b82f6"
            },
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: " "
                  }
                ]
              }
            ]
          })
          .run();
        break;
      case "callout-done":
        editor
          .chain()
          .focus()
          .insertContent({
            type: "callout",
            attrs: {
              calloutEmoji: "done",
              calloutLabel: "Done",
              calloutColor: "#22c55e"
            },
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: " "
                  }
                ]
              }
            ]
          })
          .run();
        break;
      case "callout":
        editor
          .chain()
          .focus()
          .insertContent({
            type: "callout",
            attrs: {
              calloutEmoji: "info",
              calloutLabel: "Note",
              calloutColor: "#6366f1"
            },
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: " "
                  }
                ]
              }
            ]
          })
          .run();
        break;
      case "table":
        editor
          .chain()
          .focus()
          .insertTable({
            rows: 2,
            cols: 2,
            withHeaderRow: true
          })
          .run();
        break;
      case "toc":
        editor
          .chain()
          .focus()
          .insertContent({
            type: "tocBlock"
          })
          .run();
        break;
      case "math": {
        // Open the math edit popover so the user can type their formula before inserting
        editor.chain().focus().run();
        const sel =
          editor.state.selection;
        const coords =
          editor.view.coordsAtPos(
            sel.from
          );
        setMathEditDraft("");
        setMathEdit({
          pos: -1,
          latex: "",
          x: coords.left,
          y: coords.bottom + 10
        });
        break;
      }
      case "2col":
        editor
          .chain()
          .focus()
          .insertContent({
            type: "columns",
            content: [
              {
                type: "column",
                content: [
                  { type: "paragraph" }
                ]
              },
              {
                type: "column",
                content: [
                  { type: "paragraph" }
                ]
              }
            ]
          })
          .run();
        break;
      case "3col":
        editor
          .chain()
          .focus()
          .insertContent({
            type: "columns",
            content: [
              {
                type: "column",
                content: [
                  { type: "paragraph" }
                ]
              },
              {
                type: "column",
                content: [
                  { type: "paragraph" }
                ]
              },
              {
                type: "column",
                content: [
                  { type: "paragraph" }
                ]
              }
            ]
          })
          .run();
        break;
      case "code":
        editor
          .chain()
          .focus()
          .insertContent(
            "<pre><code>\n// Code here\n</code></pre>"
          )
          .run();
        break;
      case "subpage": {
        // Derive the parent path from the current filePath:
        // Documents/Note.md → sub-pages go in Documents/Note/
        let parentPath = filePath;
        if (
          parentPath.endsWith(
            "/README.md"
          )
        ) {
          parentPath = parentPath.slice(
            0,
            -"/README.md".length
          );
        } else if (
          parentPath.endsWith(".md")
        ) {
          parentPath = parentPath.slice(
            0,
            -3
          );
        }
        onCreateSubPage?.(
          parentPath,
          (
            newFilePath: string,
            newTitle: string
          ) => {
            editor
              .chain()
              .focus()
              .insertContent(
                `<a href="${newFilePath}">${newTitle}</a> `
              )
              .run();
            const html =
              editor.getHTML();
            const markdown =
              turndownService.turndown(
                html
              );
            return markdown;
          }
        );
        break;
      }
      case "embed": {
        setEmbedUrl("");
        setSelectedCanvasPath("");
        setSelectedMindmapPath("");
        setEmbedType("url");
        setEmbedModalOpen(true);
        break;
      }
      case "date-picker": {
        // Open the calendar popover so the user can pick any date before inserting
        editor.chain().focus().run();
        const sel =
          editor.state.selection;
        const coords =
          editor.view.coordsAtPos(
            sel.from
          );
        setDateEditDraft(
          toISODateInput(new Date())
        );
        const popoverH = 170;
        const flipUp =
          window.innerHeight -
            coords.bottom <
          popoverH;
        setDateEdit({
          x: coords.left,
          y: flipUp
            ? Math.max(
                4,
                coords.top -
                  popoverH -
                  4
              )
            : coords.bottom + 10
        });
        break;
      }
    }
    setCommandActive(false);
  };

  const getFileIcon = (
    type: string
  ) => {
    switch (type) {
      case "task":
        return (
          <CheckSquare
            size={13}
            className="text-amber-500 shrink-0"
          />
        );
      case "canvas":
        return (
          <Brush
            size={13}
            className="text-emerald-400 shrink-0"
          />
        );
      case "board":
        return (
          <LayoutGrid
            size={13}
            className="text-violet-400 shrink-0"
          />
        );
      default:
        return (
          <FileText
            size={13}
            className="text-blue-400 shrink-0"
          />
        );
    }
  };

  const getFilteredEmojis = () => {
    const query = emojiQuery
      .toLowerCase()
      .trim();
    if (!query) {
      // Return first 10 emojis
      return EMOJI_LIST.slice(0, 10);
    }
    return EMOJI_LIST.filter((e) =>
      e.name.includes(query)
    ).slice(0, 10);
  };

  const executeEmoji = (
    emojiChar: string
  ) => {
    if (!editor) return;
    const { selection } = editor.state;
    const queryLength =
      emojiQuery.length + 1; // +1 for the ':'
    editor
      .chain()
      .focus()
      .deleteRange({
        from:
          selection.from - queryLength,
        to: selection.from
      })
      .insertContent(emojiChar)
      .run();
    setEmojiActive(false);
  };

  // Derive workspace-scoped file list so embed / mention pickers only show
  // files that belong to the same workspace as the current document.
  const SECTION_ROOTS = new Set([
    "Documents",
    "Tasks",
    "Boards",
    "Canvas",
    "MindMaps"
  ]);
  const wsPrefix = (() => {
    const first =
      filePath.split("/")[0];
    return SECTION_ROOTS.has(first)
      ? ""
      : first + "/";
  })();
  const wsFiles = wsPrefix
    ? files.filter((f) =>
        f.path.startsWith(wsPrefix)
      )
    : files.filter((f) =>
        SECTION_ROOTS.has(
          f.path.split("/")[0]
        )
      );

  const getFilteredMentions = () => {
    const query = mentionQuery
      .toLowerCase()
      .trim();
    const otherFiles = wsFiles.filter(
      (f) => f.path !== filePath
    );
    if (!query) return otherFiles;
    return otherFiles.filter(
      (f) =>
        f.title
          .toLowerCase()
          .includes(query) ||
        f.path
          .toLowerCase()
          .includes(query)
    );
  };

  const executeMention = (
    file: FileRecord
  ) => {
    if (!editor) return;

    const { selection } = editor.state;
    const queryLength =
      mentionQuery.length + 1; // +1 for the '@'

    editor
      .chain()
      .focus()
      .deleteRange({
        from:
          selection.from - queryLength,
        to: selection.from
      })
      .run();

    editor
      .chain()
      .focus()
      .insertContent(
        `<a href="${file.path}">${file.title || file.path.split("/").pop() || "Untitled"}</a> `
      )
      .run();

    setMentionActive(false);
  };

  // Tags Array helper
  const getTagsArray = () => {
    if (
      !frontMatter ||
      !frontMatter.tags
    )
      return [];
    try {
      const parsed =
        typeof frontMatter.tags ===
        "string"
          ? JSON.parse(frontMatter.tags)
          : frontMatter.tags;
      return Array.isArray(parsed)
        ? parsed
        : [];
    } catch (e) {
      return [];
    }
  };

  const handleAddTag = (
    tag: string
  ) => {
    const cleanTag = tag.trim();
    if (!cleanTag) return;
    const currentTags = getTagsArray();
    if (
      !currentTags.includes(cleanTag)
    ) {
      onUpdateFrontMatter?.({
        tags: [...currentTags, cleanTag]
      });
      onEnsureTagColor?.(cleanTag);
    }
    setNewTagInput("");
    // Deliberately not closing tagAutocompleteOpen: the input keeps focus
    // after adding a tag (see the suggestion button's onMouseDown
    // preventDefault, below), specifically so tags can be added one after
    // another without re-clicking. Force-closing here left the dropdown
    // stuck shut afterward — focus never actually left the input, so
    // nothing was left to re-trigger it back open (only onFocus/onChange do
    // that) until the user clicked away and back, or typed something.
  };

  const handleAddTagSubmit = (
    e: React.FormEvent
  ) => {
    e.preventDefault();
    handleAddTag(newTagInput);
  };

  const tagSuggestions = newTagInput
    ? boardTags.filter(
        (t) =>
          !getTagsArray().includes(t) &&
          t
            .toLowerCase()
            .includes(
              newTagInput.toLowerCase()
            )
      )
    : boardTags.filter(
        (t) =>
          !getTagsArray().includes(t)
      );

  // Portaled + position:fixed (computed from the tag field's real screen
  // position), same fix as Kanban's TagInput: a plain absolute dropdown here
  // can end up stacked behind other UI (the properties panel sits above a
  // scrollable document / a Kanban card modal), and only closing on Escape
  // (or the previous onBlur-with-timeout hack) left it stuck open when
  // clicked away from instead of dismissing like every other popover.
  useEffect(() => {
    if (!tagAutocompleteOpen || tagSuggestions.length === 0 || !tagFieldRef.current) {
      setTagDropPos(null);
      return;
    }
    const r = tagFieldRef.current.getBoundingClientRect();
    setTagDropPos({ top: r.bottom + 4, left: r.left });
  }, [tagAutocompleteOpen, tagSuggestions.length, newTagInput]);

  useEffect(() => {
    if (!tagAutocompleteOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Element;
      if (tagFieldRef.current?.contains(target)) return;
      if (tagDropdownRef.current?.contains(target)) return;
      setTagAutocompleteOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () =>
      document.removeEventListener("mousedown", handler);
  }, [tagAutocompleteOpen]);

  const handleRemoveTag = (
    tagToRemove: string
  ) => {
    const currentTags = getTagsArray();
    onUpdateFrontMatter?.({
      tags: currentTags.filter(
        (t) => t !== tagToRemove
      )
    });
  };

  if (!editor) {
    return (
      <div className="flex justify-center items-center h-64 text-slate-400">
        <Loader2 className="animate-spin mr-2" />{" "}
        Loading Editor...
      </div>
    );
  }

  const filteredList =
    getFilteredCommands();
  const tags = getTagsArray();

  const getSaveStatusIndicator = () => {
    switch (saveStatus) {
      case "saving":
        return (
          <span className="flex items-center gap-1 text-[10px] text-violet-400 font-medium">
            <Loader2
              className="animate-spin"
              size={10}
            />
            Saving changes...
          </span>
        );
      case "dirty":
        return (
          <span className="flex items-center gap-1 text-[10px] text-amber-500 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
            Unsaved changes
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-[10px] text-slate-500">
            ✓ Saved to disk
          </span>
        );
    }
  };

  return (
    <div className="flex h-full bg-[#0d1117] rounded-xl border border-slate-800 overflow-hidden shadow-2xl relative editor-root-container">
      {/* Editor Main Work Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Control Toolbar */}
        <div className="flex flex-col p-3 border-b border-slate-800 bg-[#161b22]/80 backdrop-blur-md sticky top-0 z-10 select-none no-print bf-toolbar">
          {/* Mobile condensed bar — toggle + essential save controls, always visible */}
          <div className="flex md:hidden items-center justify-between gap-2">
            <button
              onClick={() =>
                setMobileToolbarOpen(
                  (o) => !o
                )
              }
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer text-xs font-semibold"
            >
              <Type size={14} />
              Formatting
              <ChevronRight
                size={12}
                className={`transition-transform ${mobileToolbarOpen ? "rotate-90" : ""}`}
              />
            </button>
            <div className="flex items-center gap-2">
              {getSaveStatusIndicator()}
              <button
                onClick={() =>
                  executeAutoSave()
                }
                disabled={
                  saveStatus ===
                    "saved" || isSaving
                }
                className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold rounded-lg shadow transition cursor-pointer"
              >
                <Save size={12} />
              </button>
            </div>
          </div>

          {/* Full toolbar — always visible on desktop, collapsible on mobile */}
          <div
            className={`flex-wrap items-center justify-between gap-y-2 mt-2 md:mt-0 w-full ${mobileToolbarOpen ? "flex" : "hidden"} md:flex`}
          >
            <div className="flex flex-wrap items-center gap-1">
              <button
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .toggleBold()
                    .run()
                }
                className={`p-2 rounded-lg hover:bg-slate-800 hover:text-white transition ${
                  editor.isActive(
                    "bold"
                  )
                    ? "bg-violet-600/20 text-violet-400 font-bold border border-violet-500/30"
                    : "text-slate-400"
                }`}
                title="Bold"
              >
                <Bold size={16} />
              </button>
              <button
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .toggleItalic()
                    .run()
                }
                className={`p-2 rounded-lg hover:bg-slate-800 hover:text-white transition ${
                  editor.isActive(
                    "italic"
                  )
                    ? "bg-violet-600/20 text-violet-400 border border-violet-500/30"
                    : "text-slate-400"
                }`}
                title="Italic (Ctrl+I)"
              >
                <Italic size={16} />
              </button>
              <button
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .toggleUnderline()
                    .run()
                }
                className={`p-2 rounded-lg hover:bg-slate-800 hover:text-white transition ${
                  editor.isActive(
                    "underline"
                  )
                    ? "bg-violet-600/20 text-violet-400 border border-violet-500/30"
                    : "text-slate-400"
                }`}
                title="Underline (Ctrl+U)"
              >
                <UnderlineIcon
                  size={16}
                />
              </button>
              <button
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .toggleStrike()
                    .run()
                }
                className={`p-2 rounded-lg hover:bg-slate-800 hover:text-white transition ${
                  editor.isActive(
                    "strike"
                  )
                    ? "bg-violet-600/20 text-violet-400 border border-violet-500/30"
                    : "text-slate-400"
                }`}
                title="Strikethrough"
              >
                <Strikethrough
                  size={16}
                />
              </button>
              <button
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .toggleSubscript()
                    .run()
                }
                className={`p-2 rounded-lg hover:bg-slate-800 hover:text-white transition ${
                  editor.isActive(
                    "subscript"
                  )
                    ? "bg-violet-600/20 text-violet-400 border border-violet-500/30"
                    : "text-slate-400"
                }`}
                title="Subscript"
              >
                <SubscriptIcon
                  size={16}
                />
              </button>
              <button
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .toggleSuperscript()
                    .run()
                }
                className={`p-2 rounded-lg hover:bg-slate-800 hover:text-white transition ${
                  editor.isActive(
                    "superscript"
                  )
                    ? "bg-violet-600/20 text-violet-400 border border-violet-500/30"
                    : "text-slate-400"
                }`}
                title="Superscript"
              >
                <SuperscriptIcon
                  size={16}
                />
              </button>
              <div className="w-px h-4 bg-slate-700 mx-0.5" />

              {/* Text color */}
              <div
                className="relative"
                data-color-picker
              >
                <button
                  onClick={() => {
                    setTextColorOpen(
                      (v) => !v
                    );
                    setBgColorOpen(
                      false
                    );
                  }}
                  className={`p-2 rounded-lg hover:bg-slate-800 hover:text-white transition flex flex-col items-center gap-0.5 ${textColorOpen ? "bg-violet-600/20 border border-violet-500/30" : "text-slate-400"}`}
                  title="Text Color"
                >
                  <span
                    className="font-bold text-sm leading-none"
                    style={{
                      color:
                        editor.getAttributes(
                          "textStyle"
                        ).color ||
                        "currentColor"
                    }}
                  >
                    A
                  </span>
                  <span
                    className="block w-3.5 h-0.5 rounded-full"
                    style={{
                      backgroundColor:
                        editor.getAttributes(
                          "textStyle"
                        ).color ||
                        "#64748b"
                    }}
                  />
                </button>
                {textColorOpen && (
                  <div
                    className="absolute top-full left-0 mt-1 bg-[#1a2236] border border-slate-700 rounded-lg shadow-xl py-1.5 z-50 min-w-[160px]"
                    data-color-picker
                  >
                    <div className="text-[10px] text-slate-500 mb-1 font-medium uppercase tracking-wider px-3">
                      Text color
                    </div>
                    {TEXT_COLORS.map(
                      (c) => {
                        const active =
                          c.value ===
                          null
                            ? !editor.getAttributes(
                                "textStyle"
                              ).color
                            : c.value ===
                              editor.getAttributes(
                                "textStyle"
                              ).color;
                        return (
                          <button
                            key={
                              c.label
                            }
                            onMouseDown={(
                              e
                            ) => {
                              e.preventDefault();
                              if (
                                c.value
                              )
                                editor
                                  .chain()
                                  .focus()
                                  .setColor(
                                    c.value
                                  )
                                  .run();
                              else
                                editor
                                  .chain()
                                  .focus()
                                  .unsetColor()
                                  .run();
                              setTextColorOpen(
                                false
                              );
                            }}
                            className={`w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-slate-700/50 transition text-left ${active ? "bg-slate-700/40" : ""}`}
                          >
                            <span
                              className="w-4 h-4 rounded-full border border-slate-600 shrink-0 flex items-center justify-center"
                              style={{
                                backgroundColor:
                                  c.value ??
                                  "transparent"
                              }}
                            >
                              {c.value ===
                                null && (
                                <span className="text-slate-400 text-[9px]">
                                  ✕
                                </span>
                              )}
                            </span>
                            <span
                              className="text-sm"
                              style={{
                                color:
                                  c.value ===
                                  "#000000"
                                    ? "#94a3b8"
                                    : (c.value ??
                                      "#e2e8f0")
                              }}
                            >
                              {c.label}
                            </span>
                            {active && (
                              <span className="ml-auto text-violet-400 text-xs">
                                ✓
                              </span>
                            )}
                          </button>
                        );
                      }
                    )}
                  </div>
                )}
              </div>

              {/* Background / highlight color */}
              <div
                className="relative"
                data-color-picker
              >
                <button
                  onClick={() => {
                    setBgColorOpen(
                      (v) => !v
                    );
                    setTextColorOpen(
                      false
                    );
                  }}
                  className={`p-2 rounded-lg hover:bg-slate-800 hover:text-white transition flex flex-col items-center gap-0.5 ${bgColorOpen ? "bg-violet-600/20 border border-violet-500/30" : "text-slate-400"}`}
                  title="Highlight / Background Color"
                >
                  <span className="font-bold text-sm leading-none text-slate-300">
                    A
                  </span>
                  <span
                    className="block w-3.5 h-1.5 rounded-sm"
                    style={{
                      backgroundColor:
                        editor.getAttributes(
                          "highlight"
                        ).color ||
                        "#64748b"
                    }}
                  />
                </button>
                {bgColorOpen && (
                  <div
                    className="absolute top-full left-0 mt-1 bg-[#1a2236] border border-slate-700 rounded-lg shadow-xl py-1.5 z-50 min-w-[160px]"
                    data-color-picker
                  >
                    <div className="text-[10px] text-slate-500 mb-1 font-medium uppercase tracking-wider px-3">
                      Highlight
                    </div>
                    {BG_COLORS.map(
                      (c) => {
                        const active =
                          c.value ===
                          null
                            ? !editor.getAttributes(
                                "highlight"
                              ).color
                            : c.value ===
                              editor.getAttributes(
                                "highlight"
                              ).color;
                        return (
                          <button
                            key={
                              c.label
                            }
                            onMouseDown={(
                              e
                            ) => {
                              e.preventDefault();
                              if (
                                c.value
                              )
                                editor
                                  .chain()
                                  .focus()
                                  .setHighlight(
                                    {
                                      color:
                                        c.value
                                    }
                                  )
                                  .run();
                              else
                                editor
                                  .chain()
                                  .focus()
                                  .unsetHighlight()
                                  .run();
                              setBgColorOpen(
                                false
                              );
                            }}
                            className={`w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-slate-700/50 transition text-left ${active ? "bg-slate-700/40" : ""}`}
                          >
                            <span
                              className="w-4 h-4 rounded-sm border border-slate-600 shrink-0 flex items-center justify-center"
                              style={{
                                backgroundColor:
                                  c.value ??
                                  "transparent"
                              }}
                            >
                              {c.value ===
                                null && (
                                <span className="text-slate-400 text-[9px]">
                                  ✕
                                </span>
                              )}
                            </span>
                            <span className="text-sm text-slate-200">
                              {c.label}
                            </span>
                            {active && (
                              <span className="ml-auto text-violet-400 text-xs">
                                ✓
                              </span>
                            )}
                          </button>
                        );
                      }
                    )}
                  </div>
                )}
              </div>

              <span className="w-px h-6 bg-slate-800 mx-1" />

              <button
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .toggleHeading({
                      level: 1
                    })
                    .run()
                }
                className={`p-2 rounded-lg hover:bg-slate-800 hover:text-white transition ${
                  editor.isActive(
                    "heading",
                    { level: 1 }
                  )
                    ? "bg-violet-600/20 text-violet-400 border border-violet-500/30"
                    : "text-slate-400"
                }`}
                title="Heading 1"
              >
                <Heading1 size={16} />
              </button>
              <button
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .toggleHeading({
                      level: 2
                    })
                    .run()
                }
                className={`p-2 rounded-lg hover:bg-slate-800 hover:text-white transition ${
                  editor.isActive(
                    "heading",
                    { level: 2 }
                  )
                    ? "bg-violet-600/20 text-violet-400 border border-violet-500/30"
                    : "text-slate-400"
                }`}
                title="Heading 2"
              >
                <Heading2 size={16} />
              </button>

              <span className="w-px h-6 bg-slate-800 mx-1" />

              <button
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .toggleTaskList()
                    .run()
                }
                className={`p-2 rounded-lg hover:bg-slate-800 hover:text-white transition ${
                  editor.isActive(
                    "taskList"
                  )
                    ? "bg-violet-600/20 text-violet-400 border border-violet-500/30"
                    : "text-slate-400"
                }`}
                title="Task Checklist"
              >
                <CheckSquare
                  size={16}
                />
              </button>
              <button
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .insertContent(
                      "<table><thead><tr><th>Header 1</th><th>Header 2</th></tr></thead><tbody><tr><td>Cell 1</td><td>Cell 2</td></tr></tbody></table>"
                    )
                    .run()
                }
                className="p-2 rounded-lg hover:bg-slate-800 hover:text-white text-slate-400 transition"
                title="Insert Table"
              >
                <Grid size={16} />
              </button>

              <span className="w-px h-6 bg-slate-800 mx-1" />

              <button
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .undo()
                    .run()
                }
                disabled={
                  !editor.can().undo()
                }
                className="p-2 rounded-lg hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent text-slate-400 hover:text-white transition"
                title="Undo"
              >
                <Undo size={16} />
              </button>
              <button
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .redo()
                    .run()
                }
                disabled={
                  !editor.can().redo()
                }
                className="p-2 rounded-lg hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent text-slate-400 hover:text-white transition"
                title="Redo"
              >
                <Redo size={16} />
              </button>
            </div>

            {/* Right Toolbar Actions */}
            <div className="flex flex-wrap items-center gap-3">
              {getSaveStatusIndicator()}

              {/* Layout radio group — fixed position, no shifting */}
              {(() => {
                const globalLocked =
                  !!globalLayoutOverride &&
                  globalLayoutOverride !==
                    "per-page";
                const layouts: {
                  id:
                    | "left"
                    | "center"
                    | "full";
                  icon: React.ReactNode;
                  title: string;
                }[] = [
                  {
                    id: "left",
                    icon: (
                      <AlignLeft
                        size={13}
                      />
                    ),
                    title:
                      "Left aligned"
                  },
                  {
                    id: "center",
                    icon: (
                      <AlignCenter
                        size={13}
                      />
                    ),
                    title:
                      "Center aligned"
                  },
                  {
                    id: "full",
                    icon: (
                      <Maximize2
                        size={13}
                      />
                    ),
                    title: "Full width"
                  }
                ];
                return (
                  <div
                    className={`flex items-center rounded-lg border ${globalLocked ? "border-amber-500/30 bg-amber-500/5" : "border-slate-700"} overflow-hidden`}
                    title={
                      globalLocked
                        ? "Layout locked by Settings → Editor Layout"
                        : undefined
                    }
                  >
                    {globalLocked && (
                      <div className="flex items-center gap-1 px-1.5 border-r border-amber-500/30">
                        <Lock
                          size={9}
                          className="text-amber-400"
                        />
                      </div>
                    )}
                    {layouts.map(
                      ({
                        id,
                        icon,
                        title
                      }) => {
                        const isActive =
                          layout === id;
                        return (
                          <button
                            key={id}
                            disabled={
                              globalLocked
                            }
                            onClick={async () => {
                              if (
                                globalLocked
                              )
                                return;
                              if (
                                onUpdateFrontMatter
                              )
                                await onUpdateFrontMatter(
                                  {
                                    layout:
                                      id
                                  }
                                );
                              else
                                setLocalLayout(
                                  id
                                );
                            }}
                            title={
                              globalLocked
                                ? `Layout locked by Settings (currently: ${layout})`
                                : title
                            }
                            className={`p-1.5 transition ${
                              globalLocked
                                ? "cursor-not-allowed opacity-40 text-slate-500"
                                : isActive
                                  ? "bg-violet-600/20 text-violet-400 cursor-pointer"
                                  : "text-slate-500 hover:text-slate-300 hover:bg-slate-800 cursor-pointer"
                            }`}
                          >
                            {icon}
                          </button>
                        );
                      }
                    )}
                  </div>
                );
              })()}

              {/* Column width — only shown when not full-width and not globally locked */}
              {layout !== "full" &&
                (() => {
                  const globalLocked =
                    !!globalColumnWidthOverride &&
                    globalColumnWidthOverride !==
                      "per-page";
                  const widths: {
                    id:
                      | "narrow"
                      | "normal"
                      | "wide";
                    label: string;
                  }[] = [
                    {
                      id: "narrow",
                      label: "N"
                    },
                    {
                      id: "normal",
                      label: "M"
                    },
                    {
                      id: "wide",
                      label: "W"
                    }
                  ];
                  return (
                    <div
                      className={`flex items-center rounded-lg border ${globalLocked ? "border-amber-500/30 bg-amber-500/5" : "border-slate-700"} overflow-hidden`}
                      title={
                        globalLocked
                          ? "Column width locked by Settings → Editor Layout"
                          : "Column width"
                      }
                    >
                      {globalLocked && (
                        <div className="flex items-center px-1.5 border-r border-amber-500/30">
                          <Lock
                            size={9}
                            className="text-amber-400"
                          />
                        </div>
                      )}
                      {widths.map(
                        ({
                          id,
                          label
                        }) => {
                          const isActive =
                            columnWidth ===
                            id;
                          return (
                            <button
                              key={id}
                              disabled={
                                globalLocked
                              }
                              onClick={async () => {
                                if (
                                  globalLocked
                                )
                                  return;
                                if (
                                  onUpdateFrontMatter
                                )
                                  await onUpdateFrontMatter(
                                    {
                                      columnWidth:
                                        id
                                    }
                                  );
                                else
                                  setLocalColumnWidth(
                                    id
                                  );
                              }}
                              title={
                                globalLocked
                                  ? `Width locked by Settings (currently: ${columnWidth})`
                                  : `${id} width`
                              }
                              className={`px-1.5 py-1 text-[10px] font-bold transition ${
                                globalLocked
                                  ? "cursor-not-allowed opacity-40 text-slate-500"
                                  : isActive
                                    ? "bg-violet-600/20 text-violet-400 cursor-pointer"
                                    : "text-slate-500 hover:text-slate-300 hover:bg-slate-800 cursor-pointer"
                              }`}
                            >
                              {label}
                            </button>
                          );
                        }
                      )}
                    </div>
                  );
                })()}

              {/* Word count + reading time */}
              <span
                className="text-[10px] text-slate-500 select-none whitespace-nowrap hidden sm:block"
                title="Word count / reading time"
              >
                {wordCount} words ·{" "}
                {Math.max(
                  1,
                  Math.ceil(
                    wordCount / 200
                  )
                )}{" "}
                min read
              </span>

              {/* Font size S/M/L */}
              <div className="flex items-center gap-0.5 bg-slate-800/60 rounded-lg p-0.5">
                {(
                  [
                    "sm",
                    "base",
                    "lg"
                  ] as const
                ).map((sz) => (
                  <button
                    key={sz}
                    onClick={() =>
                      setEditorFontSize(
                        sz
                      )
                    }
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider transition ${
                      editorFontSize ===
                      sz
                        ? "bg-violet-600/30 text-violet-400"
                        : "text-slate-500 hover:text-slate-300"
                    }`}
                    title={
                      sz === "sm"
                        ? "Small text"
                        : sz === "base"
                          ? "Normal text"
                          : "Large text"
                    }
                  >
                    {sz === "sm"
                      ? "S"
                      : sz === "base"
                        ? "M"
                        : "L"}
                  </button>
                ))}
              </div>

              {/* TOC toggle */}
              <button
                onClick={() =>
                  setTocOpen(!tocOpen)
                }
                className={`p-2 rounded-lg hover:bg-slate-800 transition cursor-pointer ${
                  tocOpen
                    ? "bg-violet-600/20 text-violet-400 border border-violet-500/30"
                    : "text-slate-400"
                }`}
                title="Table of Contents"
              >
                <BookOpen size={16} />
              </button>

              <button
                onClick={() =>
                  setBacklinksOpen(
                    !backlinksOpen
                  )
                }
                className={`p-2 rounded-lg hover:bg-slate-800 transition cursor-pointer ${
                  backlinksOpen
                    ? "bg-violet-600/20 text-violet-400 border border-violet-500/30"
                    : "text-slate-400"
                }`}
                title="Backlinks — pages that link here"
              >
                <LinkIcon size={16} />
              </button>

              <button
                onClick={() =>
                  setHistoryOpen(
                    !historyOpen
                  )
                }
                className={`p-2 rounded-lg hover:bg-slate-800 transition cursor-pointer ${
                  historyOpen
                    ? "bg-violet-600/20 text-violet-400 border border-violet-500/30"
                    : "text-slate-400"
                }`}
                title="Version History"
              >
                <History size={16} />
              </button>

              <button
                onClick={() =>
                  setSlideshowOpen(true)
                }
                className="p-2 rounded-lg hover:bg-slate-800 transition cursor-pointer text-slate-400 hover:text-white"
                title="Present as Slideshow — split slides with a horizontal rule (---)"
              >
                <Presentation
                  size={16}
                />
              </button>

              {/* Export Dropdown Menu */}
              <div className="relative">
                <button
                  onClick={() =>
                    setExportDropdownOpen(
                      !exportDropdownOpen
                    )
                  }
                  className={`p-2 rounded-lg hover:bg-slate-800 transition cursor-pointer flex items-center gap-1 text-slate-400 hover:text-white ${
                    exportDropdownOpen
                      ? "bg-slate-800 text-white"
                      : ""
                  }`}
                  title="Export Page"
                >
                  <Download size={16} />
                </button>

                {exportDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() =>
                        setExportDropdownOpen(
                          false
                        )
                      }
                    />
                    <div className="absolute right-0 mt-1.5 w-44 bg-[#161b22] border border-slate-800 rounded-xl shadow-2xl p-1.5 flex flex-col space-y-0.5 z-20 no-scrollbar select-none text-slate-200">
                      <button
                        onClick={() => {
                          setExportDropdownOpen(
                            false
                          );
                          window.print();
                        }}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-semibold hover:bg-slate-800 text-slate-305 hover:text-white transition flex items-center gap-2 cursor-pointer"
                      >
                        <FileText
                          size={12}
                          className="text-red-450"
                        />
                        <span>
                          Export to PDF
                        </span>
                      </button>
                      <button
                        onClick={() => {
                          setExportDropdownOpen(
                            false
                          );
                          const html =
                            editor?.getHTML() ||
                            "";
                          const markdownBody =
                            turndownService.turndown(
                              html
                            );

                          let fmString =
                            "";
                          if (
                            frontMatter &&
                            Object.keys(
                              frontMatter
                            ).length > 0
                          ) {
                            fmString =
                              "---\n";
                            for (const [
                              k,
                              v
                            ] of Object.entries(
                              frontMatter
                            )) {
                              if (
                                v !==
                                  undefined &&
                                v !==
                                  null &&
                                v !== ""
                              ) {
                                fmString += `${k}: ${JSON.stringify(v)}\n`;
                              }
                            }
                            fmString +=
                              "---\n\n";
                          }

                          const fullContent =
                            fmString +
                            markdownBody;
                          const blob =
                            new Blob(
                              [
                                fullContent
                              ],
                              {
                                type: "text/markdown;charset=utf-8"
                              }
                            );
                          const url =
                            URL.createObjectURL(
                              blob
                            );
                          const link =
                            document.createElement(
                              "a"
                            );
                          link.href =
                            url;
                          link.download =
                            filePath
                              .split(
                                "/"
                              )
                              .pop() ||
                            "note.md";
                          link.click();
                          URL.revokeObjectURL(
                            url
                          );
                        }}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-semibold hover:bg-slate-800 text-slate-305 hover:text-white transition flex items-center gap-2 cursor-pointer"
                      >
                        <FileText
                          size={12}
                          className="text-violet-450"
                        />
                        <span>
                          Export to
                          Markdown
                        </span>
                      </button>
                      <button
                        onClick={() => {
                          setExportDropdownOpen(
                            false
                          );
                          const html =
                            editor?.getHTML() ||
                            "";
                          const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${filePath.split("/").pop()?.replace(".md", "") || "Exported Note"}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #24292f;
      background-color: #ffffff;
      line-height: 1.6;
      padding: 2rem;
      max-width: 800px;
      margin: 0 auto;
    }
    pre {
      background-color: #f6f8fa;
      padding: 16px;
      border-radius: 6px;
      overflow: auto;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
      font-size: 85%;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1.5rem 0;
    }
    th, td {
      border: 1px solid #d0d7de;
      padding: 8px 12px;
    }
    th {
      background-color: #f6f8fa;
    }
    .callout-box {
      padding: 16px;
      border-left: 4px solid #8b5cf6;
      background-color: #f8f9fa;
      border-radius: 0 8px 8px 0;
      margin: 1.5rem 0;
    }
  </style>
</head>
<body>
  <h1>${filePath.split("/").pop()?.replace(".md", "") || "Note"}</h1>
  ${html}
</body>
</html>`;
                          const blob =
                            new Blob(
                              [
                                htmlContent
                              ],
                              {
                                type: "text/html;charset=utf-8"
                              }
                            );
                          const url =
                            URL.createObjectURL(
                              blob
                            );
                          const link =
                            document.createElement(
                              "a"
                            );
                          link.href =
                            url;
                          link.download =
                            (filePath
                              .split(
                                "/"
                              )
                              .pop()
                              ?.replace(
                                ".md",
                                ""
                              ) ||
                              "note") +
                            ".html";
                          link.click();
                          URL.revokeObjectURL(
                            url
                          );
                        }}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-semibold hover:bg-slate-800 text-slate-305 hover:text-white transition flex items-center gap-2 cursor-pointer"
                      >
                        <FileText
                          size={12}
                          className="text-emerald-450"
                        />
                        <span>
                          Export to HTML
                        </span>
                      </button>
                    </div>
                  </>
                )}
              </div>

              <button
                onClick={() =>
                  executeAutoSave()
                }
                disabled={
                  saveStatus ===
                    "saved" || isSaving
                }
                className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold rounded-lg shadow transition cursor-pointer"
              >
                <Save size={12} />
                Save Now
              </button>
            </div>
          </div>
        </div>

        {/* Editor Body & Page Properties Panel */}
        <div className="flex-1 overflow-y-auto px-3 py-4 md:px-8 md:py-6 no-scrollbar flex flex-col print-document-container">
          {/* Remote-conflict banner — this page changed elsewhere while we
              were focused (see the content-sync effect above), so the local
              edit wasn't overwritten automatically. Surface the choice
              instead of silently discarding one side on the next autosave. */}
          {remoteConflict && (
            <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-300 text-xs font-medium no-print">
              <span>
                This page was changed elsewhere while you were editing. Reload to see the latest version (your unsaved edits will be lost), or keep editing — your version will overwrite theirs when it saves.
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={applyRemoteContent}
                  className="px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 transition cursor-pointer"
                >
                  Reload
                </button>
                <button
                  onClick={() => setRemoteConflict(false)}
                  className="px-2.5 py-1 rounded-md hover:bg-amber-500/10 text-amber-300/80 transition cursor-pointer"
                >
                  Keep editing
                </button>
              </div>
            </div>
          )}
          {/* File path breadcrumbs */}
          <div className="text-[10px] text-slate-500 font-mono mb-4 uppercase tracking-wider select-none">
            {filePath}
          </div>

          {/* Page Properties Panel */}
          {frontMatter &&
            onUpdateFrontMatter && (
              <div
                className={`mb-4 bg-[#161b22]/40 border border-slate-800/80 rounded-xl select-none transition-all duration-300 no-print bf-properties ${getWidthClass()}`}
              >
                <button
                  type="button"
                  onClick={() =>
                    setPropertiesCollapsed(
                      (c) => {
                        const next = !c;
                        fetch(
                          `${API_BASE}/api/settings`,
                          {
                            method:
                              "POST",
                            headers: {
                              "Content-Type":
                                "application/json"
                            },
                            body: JSON.stringify(
                              {
                                properties_collapsed:
                                  next
                              }
                            )
                          }
                        ).catch(
                          () => {}
                        );
                        onSavePropertiesCollapsed?.(
                          next
                        );
                        return next;
                      }
                    )
                  }
                  className="w-full flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider hover:text-slate-300 transition cursor-pointer"
                >
                  <Activity
                    size={10}
                    className="text-violet-400"
                  />
                  Page Attributes
                  <ChevronRight
                    size={10}
                    className={`ml-auto transition-transform duration-200 ${propertiesCollapsed ? "" : "rotate-90"}`}
                  />
                </button>

                <div
                  className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${propertiesCollapsed ? "[grid-template-rows:0fr]" : "[grid-template-rows:1fr]"}`}
                >
                  <div className="overflow-hidden">
                    <div className="px-3 pb-3 space-y-2">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                        {/* 1. Title Input — commits (renames) on blur/Enter
                            rather than per-keystroke, same as the big
                            in-editor title heading below; both go through
                            commitTitleChange. */}
                        <div className="flex items-center gap-3 group">
                          <span className="w-20 text-slate-500 font-medium flex items-center gap-1.5 shrink-0">
                            <Info
                              size={12}
                            />
                            Title
                          </span>
                          <input
                            type="text"
                            value={
                              pageAttrTitleDraft !==
                              null
                                ? pageAttrTitleDraft
                                : frontMatter.title ||
                                  ""
                            }
                            onFocus={() =>
                              setPageAttrTitleDraft(
                                frontMatter.title ||
                                  ""
                              )
                            }
                            onChange={(
                              e
                            ) =>
                              setPageAttrTitleDraft(
                                e
                                  .target
                                  .value
                              )
                            }
                            onBlur={() => {
                              if (
                                pageAttrTitleCancelRef.current
                              ) {
                                pageAttrTitleCancelRef.current =
                                  false;
                              } else if (
                                pageAttrTitleDraft !==
                                null
                              ) {
                                commitTitleChange(
                                  pageAttrTitleDraft
                                );
                              }
                              setPageAttrTitleDraft(
                                null
                              );
                            }}
                            onKeyDown={(
                              e
                            ) => {
                              if (
                                e.key ===
                                "Enter"
                              )
                                (
                                  e.target as HTMLInputElement
                                ).blur();
                              else if (
                                e.key ===
                                "Escape"
                              ) {
                                pageAttrTitleCancelRef.current =
                                  true;
                                (
                                  e.target as HTMLInputElement
                                ).blur();
                              }
                            }}
                            className="flex-1 bg-transparent hover:bg-slate-800/40 focus:bg-slate-900 border border-transparent focus:border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none transition"
                          />
                        </div>

                        {/* 2. Status Select Lane */}
                        <div className="flex items-center gap-3">
                          <span className="w-20 text-slate-500 font-medium flex items-center gap-1.5 shrink-0">
                            <CheckSquare
                              size={12}
                            />
                            Status
                          </span>
                          <select
                            value={
                              frontMatter.status ||
                              ""
                            }
                            onChange={(
                              e
                            ) =>
                              onUpdateFrontMatter(
                                {
                                  status:
                                    e
                                      .target
                                      .value
                                }
                              )
                            }
                            className="flex-1 bg-slate-900/50 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded px-2.5 py-1 outline-none transition cursor-pointer"
                          >
                            <option value="">
                              Unassigned
                              (Document)
                            </option>
                            {boardColumns.map(
                              (col) => (
                                <option
                                  key={
                                    col
                                  }
                                  value={
                                    col
                                  }
                                >
                                  {col}
                                </option>
                              )
                            )}
                          </select>
                        </div>

                        {/* 3. Priority Level */}
                        <div className="flex items-center gap-3">
                          <span className="w-20 text-slate-500 font-medium flex items-center gap-1.5 shrink-0">
                            <AlertCircle
                              size={12}
                            />
                            Priority
                          </span>
                          <select
                            value={
                              frontMatter.priority ||
                              ""
                            }
                            onChange={(
                              e
                            ) =>
                              onUpdateFrontMatter(
                                {
                                  priority:
                                    e
                                      .target
                                      .value ||
                                    null
                                }
                              )
                            }
                            className="flex-1 bg-slate-900/50 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded px-2.5 py-1 outline-none transition cursor-pointer"
                          >
                            <option value="">
                              No
                              priority
                            </option>
                            <option value="Urgent">
                              Urgent
                            </option>
                            <option value="High">
                              High
                            </option>
                            <option value="Medium">
                              Medium
                            </option>
                            <option value="Low">
                              Low
                            </option>
                          </select>
                        </div>

                        {/* 4. Due Date + optional Time Picker */}
                        {(() => {
                          const raw =
                            frontMatter.dueDate ||
                            "";
                          const hasTime =
                            raw.includes(
                              "T"
                            );
                          const datePart =
                            hasTime
                              ? raw.split(
                                  "T"
                                )[0]
                              : raw;
                          const timePart =
                            hasTime
                              ? raw.split(
                                  "T"
                                )[1]
                              : "";

                          const parseH12 =
                            (
                              t: string
                            ) => {
                              if (!t)
                                return {
                                  h: 9,
                                  m: 0,
                                  ampm: "AM" as
                                    | "AM"
                                    | "PM"
                                };
                              const [
                                hh,
                                mm
                              ] = t
                                .split(
                                  ":"
                                )
                                .map(
                                  Number
                                );
                              return {
                                h:
                                  hh %
                                    12 ||
                                  12,
                                m: mm,
                                ampm: (hh >=
                                12
                                  ? "PM"
                                  : "AM") as
                                  | "AM"
                                  | "PM"
                              };
                            };
                          const {
                            h: selH,
                            m: selM,
                            ampm: selAp
                          } = parseH12(
                            timePart
                          );

                          const toH24 =
                            (
                              h: number,
                              ap:
                                | "AM"
                                | "PM"
                            ) =>
                              ap ===
                              "PM"
                                ? h ===
                                  12
                                  ? 12
                                  : h +
                                    12
                                : h ===
                                    12
                                  ? 0
                                  : h;
                          const buildTime =
                            (
                              h: number,
                              m: number,
                              ap:
                                | "AM"
                                | "PM"
                            ) =>
                              `${String(toH24(h, ap)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
                          const setDue =
                            (
                              d: string,
                              t?: string
                            ) =>
                              onUpdateFrontMatter(
                                {
                                  dueDate:
                                    t
                                      ? `${d}T${t}`
                                      : d
                                }
                              );

                          const duePast =
                            raw
                              ? hasTime
                                ? new Date(
                                    raw
                                  ) <
                                  new Date()
                                : new Date(
                                    datePart
                                  ) <
                                  new Date(
                                    new Date().toDateString()
                                  )
                              : false;

                          return (
                            <div className="flex items-start gap-3">
                              <span
                                className={`w-20 font-medium flex items-center gap-1.5 shrink-0 pt-1 ${duePast ? "text-red-400" : "text-slate-500"}`}
                              >
                                <Calendar
                                  size={
                                    12
                                  }
                                />
                                Due Date
                              </span>
                              <div className="flex-1 flex flex-col gap-1.5">
                                {/* Date row */}
                                <div className="flex items-center gap-2">
                                  {isMobile ? (
                                    <input
                                      type="date"
                                      value={
                                        datePart
                                      }
                                      onChange={(
                                        e
                                      ) => {
                                        const d =
                                          e
                                            .target
                                            .value;
                                        setDue(
                                          d,
                                          hasTime
                                            ? timePart ||
                                                "09:00"
                                            : undefined
                                        );
                                      }}
                                      onClick={(
                                        e
                                      ) => {
                                        // Most mobile browsers already open
                                        // the native picker on any tap in the
                                        // field; this is only a fallback for
                                        // the ones that don't.
                                        try {
                                          e.currentTarget.showPicker?.();
                                        } catch {
                                          // Unsupported/blocked — the field
                                          // is still directly editable.
                                        }
                                      }}
                                      className={`flex-1 bg-slate-900/50 hover:bg-slate-800 rounded px-2.5 py-1 outline-none transition cursor-pointer ${duePast ? "border border-red-500/50 text-red-400" : "border border-slate-800 text-slate-300"}`}
                                    />
                                  ) : (
                                    <>
                                      <div
                                        ref={
                                          dueDateBoxRef
                                        }
                                        onClick={() => {
                                          if (
                                            dueDateBoxRef.current
                                          ) {
                                            const r =
                                              dueDateBoxRef.current.getBoundingClientRect();
                                            setDueDateAnchorRect(
                                              {
                                                top: r.top,
                                                left: r.left,
                                                bottom:
                                                  r.bottom
                                              }
                                            );
                                          }
                                          setDueDateCalendarOpen(
                                            true
                                          );
                                        }}
                                        className={`flex-1 flex items-center gap-2 bg-slate-900/50 hover:bg-slate-800 rounded px-2.5 py-1 outline-none transition cursor-pointer ${duePast ? "border border-red-500/50 text-red-400" : "border border-slate-800 text-slate-300"}`}
                                      >
                                        <Calendar
                                          size={
                                            12
                                          }
                                          className="opacity-50 shrink-0"
                                        />
                                        <span
                                          className={
                                            datePart
                                              ? ""
                                              : "text-slate-600"
                                          }
                                        >
                                          {datePart
                                            ? formatDisplayDate(
                                                new Date(
                                                  datePart +
                                                    "T00:00:00"
                                                ),
                                                dateFormat
                                              )
                                            : "Select date…"}
                                        </span>
                                      </div>
                                      {dueDateCalendarOpen &&
                                        dueDateAnchorRect && (
                                          <CalendarPopover
                                            value={
                                              datePart
                                            }
                                            anchorRect={
                                              dueDateAnchorRect
                                            }
                                            onChange={(
                                              d
                                            ) =>
                                              setDue(
                                                d,
                                                hasTime &&
                                                  d
                                                  ? timePart ||
                                                      "09:00"
                                                  : undefined
                                              )
                                            }
                                            onClose={() =>
                                              setDueDateCalendarOpen(
                                                false
                                              )
                                            }
                                          />
                                        )}
                                    </>
                                  )}
                                  {datePart && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        hasTime
                                          ? setDue(
                                              datePart
                                            )
                                          : setDue(
                                              datePart,
                                              "09:00"
                                            )
                                      }
                                      title={
                                        hasTime
                                          ? "Remove time"
                                          : "Add time"
                                      }
                                      className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition border shrink-0 ${
                                        hasTime
                                          ? "bg-violet-500/15 border-violet-500/40 text-violet-300"
                                          : "border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600"
                                      }`}
                                    >
                                      <Clock
                                        size={
                                          11
                                        }
                                      />
                                      {hasTime
                                        ? `${selH}:${String(selM).padStart(2, "0")} ${selAp}`
                                        : "Time"}
                                    </button>
                                  )}
                                </div>

                                {/* Time row — only shown when time is active */}
                                {hasTime &&
                                  datePart && (
                                    <div className="flex items-center gap-1.5">
                                      <select
                                        value={
                                          selH
                                        }
                                        onChange={(
                                          e
                                        ) =>
                                          setDue(
                                            datePart,
                                            buildTime(
                                              Number(
                                                e
                                                  .target
                                                  .value
                                              ),
                                              selM,
                                              selAp
                                            )
                                          )
                                        }
                                        className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-300 text-xs outline-none cursor-pointer"
                                      >
                                        {[
                                          1,
                                          2,
                                          3,
                                          4,
                                          5,
                                          6,
                                          7,
                                          8,
                                          9,
                                          10,
                                          11,
                                          12
                                        ].map(
                                          (
                                            h
                                          ) => (
                                            <option
                                              key={
                                                h
                                              }
                                              value={
                                                h
                                              }
                                            >
                                              {
                                                h
                                              }
                                            </option>
                                          )
                                        )}
                                      </select>
                                      <span className="text-slate-500 text-xs font-bold select-none">
                                        :
                                      </span>
                                      <select
                                        value={
                                          selM
                                        }
                                        onChange={(
                                          e
                                        ) =>
                                          setDue(
                                            datePart,
                                            buildTime(
                                              selH,
                                              Number(
                                                e
                                                  .target
                                                  .value
                                              ),
                                              selAp
                                            )
                                          )
                                        }
                                        className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-300 text-xs outline-none cursor-pointer"
                                      >
                                        {[
                                          0,
                                          5,
                                          10,
                                          15,
                                          20,
                                          25,
                                          30,
                                          35,
                                          40,
                                          45,
                                          50,
                                          55
                                        ].map(
                                          (
                                            m
                                          ) => (
                                            <option
                                              key={
                                                m
                                              }
                                              value={
                                                m
                                              }
                                            >
                                              {String(
                                                m
                                              ).padStart(
                                                2,
                                                "0"
                                              )}
                                            </option>
                                          )
                                        )}
                                      </select>
                                      <div className="flex rounded overflow-hidden border border-slate-700 text-xs">
                                        {(
                                          [
                                            "AM",
                                            "PM"
                                          ] as const
                                        ).map(
                                          (
                                            ap
                                          ) => (
                                            <button
                                              key={
                                                ap
                                              }
                                              type="button"
                                              onClick={() =>
                                                setDue(
                                                  datePart,
                                                  buildTime(
                                                    selH,
                                                    selM,
                                                    ap
                                                  )
                                                )
                                              }
                                              className={`px-2.5 py-1 transition ${selAp === ap ? "bg-violet-600 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200"}`}
                                            >
                                              {
                                                ap
                                              }
                                            </button>
                                          )
                                        )}
                                      </div>
                                    </div>
                                  )}
                              </div>
                            </div>
                          );
                        })()}

                        {/* 5. Assignee */}
                        {(() => {
                          const [
                            assigneeUsers,
                            setAssigneeUsers
                          ] = useState<
                            string[]
                          >([]);
                          const [
                            assigneeOpen,
                            setAssigneeOpen
                          ] =
                            useState(
                              false
                            );
                          const assigneeRef =
                            useRef<HTMLDivElement>(
                              null
                            );
                          const assigneeVal =
                            frontMatter.assignee ||
                            "";

                          useEffect(() => {
                            fetch(
                              "/api/users",
                              {
                                credentials:
                                  "include"
                              }
                            )
                              .then(
                                (r) =>
                                  r.json()
                              )
                              .then(
                                (d) =>
                                  setAssigneeUsers(
                                    (
                                      d.users ??
                                      []
                                    ).map(
                                      (
                                        u: any
                                      ) =>
                                        u.username
                                    )
                                  )
                              )
                              .catch(
                                () => {}
                              );
                          }, []);

                          useEffect(() => {
                            if (
                              !assigneeOpen
                            )
                              return;
                            function onClickOutside(
                              e: MouseEvent
                            ) {
                              if (
                                assigneeRef.current &&
                                !assigneeRef.current.contains(
                                  e.target as Element
                                )
                              ) {
                                setAssigneeOpen(
                                  false
                                );
                              }
                            }
                            document.addEventListener(
                              "mousedown",
                              onClickOutside
                            );
                            return () =>
                              document.removeEventListener(
                                "mousedown",
                                onClickOutside
                              );
                          }, [
                            assigneeOpen
                          ]);

                          const filtered =
                            assigneeUsers.filter(
                              (u) =>
                                u
                                  .toLowerCase()
                                  .includes(
                                    assigneeVal.toLowerCase()
                                  ) &&
                                u !==
                                  assigneeVal
                            );

                          return (
                            <div
                              className="flex items-center gap-3"
                              ref={
                                assigneeRef
                              }
                            >
                              <span className="w-20 text-slate-500 font-medium flex items-center gap-1.5 shrink-0">
                                <User
                                  size={
                                    12
                                  }
                                />
                                Assignee
                              </span>
                              <div className="flex-1 relative">
                                <input
                                  type="text"
                                  value={
                                    assigneeVal
                                  }
                                  placeholder="Assignee name..."
                                  onFocus={() =>
                                    setAssigneeOpen(
                                      true
                                    )
                                  }
                                  onChange={(
                                    e
                                  ) => {
                                    onUpdateFrontMatter(
                                      {
                                        assignee:
                                          e
                                            .target
                                            .value
                                      }
                                    );
                                    setAssigneeOpen(
                                      true
                                    );
                                  }}
                                  onKeyDown={(
                                    e
                                  ) => {
                                    if (
                                      e.key ===
                                      "Escape"
                                    )
                                      setAssigneeOpen(
                                        false
                                      );
                                  }}
                                  className="w-full bg-transparent hover:bg-slate-800/40 focus:bg-slate-900 border border-transparent focus:border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none transition"
                                />
                                {assigneeOpen &&
                                  assigneeUsers.length >
                                    0 && (
                                    <div className="absolute top-full left-0 right-0 mt-1 bg-[#1c2330] border border-slate-700 rounded-lg shadow-xl z-50 overflow-hidden">
                                      {(assigneeVal ===
                                      ""
                                        ? assigneeUsers
                                        : filtered
                                      ).map(
                                        (
                                          u
                                        ) => (
                                          <button
                                            key={
                                              u
                                            }
                                            type="button"
                                            onMouseDown={(
                                              e
                                            ) => {
                                              e.preventDefault();
                                              onUpdateFrontMatter(
                                                {
                                                  assignee:
                                                    u
                                                }
                                              );
                                              setAssigneeOpen(
                                                false
                                              );
                                            }}
                                            className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-700 transition ${u === assigneeVal ? "text-indigo-400 bg-indigo-500/10" : "text-slate-300"}`}
                                          >
                                            {
                                              u
                                            }
                                          </button>
                                        )
                                      )}
                                      {assigneeVal !==
                                        "" &&
                                        filtered.length ===
                                          0 && (
                                          <div className="px-3 py-2 text-xs text-slate-500 italic">
                                            No
                                            matching
                                            users
                                          </div>
                                        )}
                                    </div>
                                  )}
                              </div>
                            </div>
                          );
                        })()}

                        {/* 6. Document Type */}
                        <div className="flex items-center gap-3">
                          <span className="w-20 text-slate-500 font-medium flex items-center gap-1.5 shrink-0">
                            <Hash
                              size={12}
                            />
                            Doc Type
                          </span>
                          <select
                            value={
                              frontMatter.type ||
                              "document"
                            }
                            onChange={(
                              e
                            ) =>
                              onUpdateFrontMatter(
                                {
                                  type: e
                                    .target
                                    .value
                                }
                              )
                            }
                            className="flex-1 bg-slate-900/50 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded px-2.5 py-1 outline-none transition cursor-pointer"
                          >
                            <option value="document">
                              document
                              (Note
                              Page)
                            </option>
                            <option value="task">
                              task
                              (Kanban
                              Lane Task)
                            </option>
                            <option value="board">
                              board
                              (Dynamic
                              Kanban
                              Board)
                            </option>
                          </select>
                        </div>
                      </div>

                      {/* Tags Field (with badge list and new tags insert field) */}
                      <div className="border-t border-slate-800/50 pt-3 flex flex-wrap items-center gap-3 text-xs">
                        <span className="text-slate-500 font-medium flex items-center gap-1.5 shrink-0">
                          <Tag
                            size={12}
                          />
                          Tags
                        </span>

                        <div className="flex flex-wrap items-center gap-1.5">
                          {tags.map(
                            (tag) => {
                              const tc = tagColors[tag] || '#8b5cf6';
                              return (
                              <span
                                key={
                                  tag
                                }
                                className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-md font-semibold border"
                                style={{ background: tc + '18', borderColor: tc + '44', color: tc }}
                              >
                                {tag}
                                <button
                                  onClick={() =>
                                    handleRemoveTag(
                                      tag
                                    )
                                  }
                                  className="hover:text-red-400 font-bold transition ml-0.5 cursor-pointer"
                                  title="Remove tag"
                                >
                                  ×
                                </button>
                              </span>
                              )
                            }
                          )}

                          <form
                            ref={tagFieldRef}
                            onSubmit={
                              handleAddTagSubmit
                            }
                            className="flex items-center gap-1 ml-1.5 relative"
                          >
                            <input
                              type="text"
                              placeholder="Add tag..."
                              value={
                                newTagInput
                              }
                              onChange={(
                                e
                              ) => {
                                setNewTagInput(
                                  e
                                    .target
                                    .value
                                );
                                setTagAutocompleteOpen(
                                  true
                                );
                              }}
                              onFocus={() =>
                                setTagAutocompleteOpen(
                                  true
                                )
                              }
                              onKeyDown={(
                                e
                              ) => {
                                if (
                                  e.key ===
                                  "Escape"
                                ) {
                                  setTagAutocompleteOpen(
                                    false
                                  );
                                  setNewTagInput(
                                    ""
                                  );
                                }
                              }}
                              className="bg-slate-900 border border-slate-700 focus:border-violet-500/50 text-[10px] rounded px-2 py-0.5 outline-none text-slate-300 w-20 focus:w-28 transition-all"
                            />
                            <button
                              type="submit"
                              className="p-1 bg-slate-800 hover:bg-violet-600 rounded text-slate-400 hover:text-white transition cursor-pointer"
                            >
                              <Plus
                                size={
                                  10
                                }
                              />
                            </button>
                            {tagAutocompleteOpen &&
                              tagSuggestions.length >
                                0 &&
                              tagDropPos &&
                              createPortal(
                                <div
                                  ref={tagDropdownRef}
                                  className="fixed bg-[#1a2236] border border-slate-700 rounded-lg shadow-xl py-1 z-[9999] min-w-[130px] max-h-36 overflow-y-auto no-scrollbar"
                                  style={{ top: tagDropPos.top, left: tagDropPos.left }}
                                >
                                  {tagSuggestions.map(
                                    (
                                      s
                                    ) => {
                                      const tc = tagColors[s] || '#8b5cf6';
                                      return (
                                      <button
                                        key={
                                          s
                                        }
                                        type="button"
                                        onMouseDown={(e) => {
                                          e.preventDefault();
                                          handleAddTag(
                                            s
                                          );
                                        }}
                                        className="flex w-full px-2.5 py-1.5 text-left cursor-pointer hover:bg-slate-800"
                                      >
                                        <span
                                          className="px-1.5 py-0.5 text-[10px] rounded-md border font-medium"
                                          style={{ background: tc + '18', borderColor: tc + '44', color: tc }}
                                        >
                                          {
                                            s
                                          }
                                        </span>
                                      </button>
                                      );
                                    }
                                  )}
                                </div>,
                                document.body
                              )}
                          </form>
                        </div>
                      </div>

                      {/* Attachments Section */}
                      <div className="border-t border-slate-800/50 pt-3 text-xs">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-slate-500 font-medium flex items-center gap-1.5">
                            <Paperclip
                              size={12}
                            />
                            Attachments
                          </span>
                          <button
                            onClick={() =>
                              attachmentInputRef.current?.click()
                            }
                            disabled={
                              attachmentUploading
                            }
                            className="flex items-center gap-1 px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded transition cursor-pointer disabled:opacity-50"
                          >
                            {attachmentUploading ? (
                              <>
                                <Loader2
                                  size={
                                    10
                                  }
                                  className="animate-spin"
                                />{" "}
                                Uploading…
                              </>
                            ) : (
                              <>
                                <Plus
                                  size={
                                    10
                                  }
                                />{" "}
                                Add file
                              </>
                            )}
                          </button>
                          <input
                            ref={
                              attachmentInputRef
                            }
                            type="file"
                            multiple
                            className="hidden"
                            onChange={(
                              e
                            ) => {
                              Array.from(
                                e.target
                                  .files ??
                                  []
                              ).forEach(
                                uploadAttachment
                              );
                              e.target.value =
                                "";
                            }}
                          />
                        </div>

                        {/* File list */}
                        {parseAttachments()
                          .length >
                          0 && (
                          <div className="space-y-1 mb-2">
                            {parseAttachments().map(
                              (att) => {
                                const isImg =
                                  isImageAttachment(
                                    att.url
                                  );
                                const isCover =
                                  frontMatter?.cover ===
                                  att.url;
                                return (
                                  <div
                                    key={
                                      att.url
                                    }
                                    className="flex items-center gap-2 px-2 py-1.5 bg-slate-900/60 border border-slate-800 rounded-lg group"
                                    onMouseEnter={
                                      isImg
                                        ? (
                                            e
                                          ) => {
                                            const rect =
                                              (
                                                e.currentTarget as HTMLElement
                                              ).getBoundingClientRect();
                                            setImgPreviewUrl(
                                              att.url
                                            );
                                            setImgPreviewPos(
                                              {
                                                top: rect.top,
                                                left:
                                                  rect.left -
                                                  148
                                              }
                                            );
                                          }
                                        : undefined
                                    }
                                    onMouseLeave={
                                      isImg
                                        ? () => {
                                            setImgPreviewUrl(
                                              null
                                            );
                                            setImgPreviewPos(
                                              null
                                            );
                                          }
                                        : undefined
                                    }
                                  >
                                    {isImg ? (
                                      <ImageIcon
                                        size={
                                          12
                                        }
                                        className={
                                          isCover
                                            ? "text-violet-400 shrink-0"
                                            : "text-slate-400 shrink-0"
                                        }
                                      />
                                    ) : (
                                      <FileText
                                        size={
                                          12
                                        }
                                        className="text-slate-500 shrink-0"
                                      />
                                    )}
                                    <span
                                      className="flex-1 text-slate-300 truncate text-[11px]"
                                      title={
                                        att.name
                                      }
                                    >
                                      {
                                        att.name
                                      }
                                    </span>
                                    <span className="text-slate-600 text-[10px] shrink-0">
                                      {formatBytes(
                                        att.size
                                      )}
                                    </span>
                                    {isImg &&
                                      isCover && (
                                        <button
                                          onClick={
                                            removeCover
                                          }
                                          className="text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0 border cursor-pointer text-violet-300 border-violet-500/40 hover:text-red-400 hover:border-red-500/40 transition-all"
                                          title="Remove cover"
                                        >
                                          ✕
                                          Cover
                                        </button>
                                      )}
                                    {isImg &&
                                      !isCover && (
                                        <button
                                          onClick={() =>
                                            setCover(
                                              att.url
                                            )
                                          }
                                          className="text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0 border cursor-pointer text-slate-500 border-slate-700 hover:text-violet-300 hover:border-violet-500/40 transition-all opacity-0 group-hover:opacity-100"
                                          title="Set as cover"
                                        >
                                          ⊞
                                          Cover
                                        </button>
                                      )}
                                    <a
                                      href={
                                        att.url
                                      }
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-slate-500 hover:text-violet-400 transition shrink-0"
                                      title="Open"
                                    >
                                      <ExternalLink
                                        size={
                                          11
                                        }
                                      />
                                    </a>
                                    <button
                                      onClick={() =>
                                        removeAttachment(
                                          att.url
                                        )
                                      }
                                      className="text-slate-600 hover:text-red-400 transition shrink-0 opacity-0 group-hover:opacity-100 cursor-pointer"
                                      title="Remove attachment"
                                    >
                                      <Trash2
                                        size={
                                          11
                                        }
                                      />
                                    </button>
                                  </div>
                                );
                              }
                            )}
                          </div>
                        )}

                        {/* Drag-and-drop / paste zone */}
                        <div
                          tabIndex={0}
                          onDragOver={(
                            e
                          ) => {
                            e.preventDefault();
                            setAttachmentDragOver(
                              true
                            );
                          }}
                          onDragLeave={() =>
                            setAttachmentDragOver(
                              false
                            )
                          }
                          onDrop={(
                            e
                          ) => {
                            e.preventDefault();
                            setAttachmentDragOver(
                              false
                            );
                            Array.from(
                              e
                                .dataTransfer
                                .files
                            ).forEach(
                              uploadAttachment
                            );
                          }}
                          onPaste={(
                            e
                          ) => {
                            const items =
                              e
                                .clipboardData
                                ?.items;
                            if (!items)
                              return;
                            if (
                              pasteImageFromClipboard(
                                items
                              )
                            ) {
                              e.preventDefault();
                              e.stopPropagation();
                            }
                          }}
                          onClick={() =>
                            attachmentInputRef.current?.click()
                          }
                          className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed cursor-pointer transition outline-none focus:ring-1 focus:ring-violet-500/40 ${
                            attachmentDragOver
                              ? "border-violet-500 bg-violet-600/10 text-violet-400"
                              : "border-slate-700 hover:border-slate-600 text-slate-600 hover:text-slate-500"
                          }`}
                        >
                          <Paperclip
                            size={11}
                          />
                          <span className="text-[11px]">
                            Drop files ·
                            click · or
                            Ctrl+V to
                            paste image
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

          {/* Page Cover + Icon header */}
          <div
            className={`${getWidthClass()} transition-all duration-300`}
          >
            {/* Cover image */}
            {frontMatter?.cover ? (
              <div
                className="-mx-4"
                onPaste={(e) => {
                  if (
                    !onUpdateFrontMatter
                  )
                    return;
                  const items =
                    e.clipboardData
                      ?.items;
                  if (!items) return;
                  const file =
                    extractImageFileFromClipboard(
                      items
                    );
                  if (file) {
                    e.preventDefault();
                    e.stopPropagation();
                    uploadCover(file);
                  }
                }}
              >
                {/* Reposition toolbar — fixed to top of viewport, immune to all overflow clipping */}
                {coverRepositioning &&
                  onUpdateFrontMatter && (
                    <div className="fixed top-0 left-0 right-0 z-[999] bg-[#0d1117]/95 backdrop-blur-md border-b border-violet-500/40 px-6 py-2.5 flex items-center gap-4 shadow-2xl">
                      <span className="text-[11px] text-slate-300 shrink-0">
                        Reposition cover
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={
                          coverPosY
                        }
                        onChange={(e) =>
                          setCoverPosY(
                            Number(
                              e.target
                                .value
                            )
                          )
                        }
                        className="flex-1 max-w-xs accent-violet-500"
                      />
                      <button
                        onMouseDown={(
                          e
                        ) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(
                          e
                        ) => {
                          e.stopPropagation();
                          onUpdateFrontMatter(
                            {
                              coverPositionY:
                                coverPosY
                            }
                          );
                          setCoverRepositioning(
                            false
                          );
                        }}
                        className="text-[11px] px-3 py-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-500 transition cursor-pointer font-medium shrink-0"
                      >
                        Save position
                      </button>
                      <button
                        onMouseDown={(
                          e
                        ) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(
                          e
                        ) => {
                          e.stopPropagation();
                          const s =
                            frontMatter?.coverPositionY;
                          const n =
                            typeof s ===
                            "number"
                              ? s
                              : Number(
                                  s
                                );
                          setCoverPosY(
                            Number.isFinite(
                              n
                            )
                              ? n
                              : 50
                          );
                          setCoverRepositioning(
                            false
                          );
                        }}
                        className="text-[11px] px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition cursor-pointer shrink-0"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                <div
                  className="relative"
                  style={{
                    height: 220
                  }}
                >
                  <img
                    src={
                      frontMatter.cover
                    }
                    alt="Cover"
                    className="w-full h-full object-cover"
                    style={{
                      objectPosition: `center ${coverPosY}%`,
                      display: "block"
                    }}
                  />
                  {onUpdateFrontMatter &&
                    !coverRepositioning && (
                      <div className="absolute top-2 right-3 flex gap-1.5 z-10">
                        <button
                          onClick={() =>
                            setCoverRepositioning(
                              true
                            )
                          }
                          className="text-[10px] px-2 py-1 bg-black/60 backdrop-blur-sm text-white rounded-md hover:bg-black/80 transition cursor-pointer"
                        >
                          Reposition
                        </button>
                        <button
                          onClick={() =>
                            onUpdateFrontMatter?.(
                              {
                                cover:
                                  ""
                              }
                            )
                          }
                          className="text-[10px] px-2 py-1 bg-black/60 backdrop-blur-sm text-white rounded-md hover:bg-red-600/80 transition cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                </div>
              </div>
            ) : (
              onUpdateFrontMatter && (
                <div
                  className="-mx-4 mb-2 border border-dashed border-slate-700/60 rounded-xl mx-0 flex items-center justify-center gap-3 py-3 text-slate-500 hover:border-slate-500 hover:text-slate-400 transition-colors group/coveradd cursor-pointer"
                  onClick={() =>
                    coverInputRef.current?.click()
                  }
                  onPaste={(e) => {
                    const items =
                      e.clipboardData
                        ?.items;
                    if (!items) return;
                    const file =
                      extractImageFileFromClipboard(
                        items
                      );
                    if (file) {
                      e.preventDefault();
                      e.stopPropagation();
                      uploadCover(file);
                    }
                  }}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (
                      e.key ===
                        "Enter" ||
                      e.key === " "
                    )
                      coverInputRef.current?.click();
                  }}
                >
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f =
                        e.target
                          .files?.[0];
                      if (f)
                        uploadCover(f);
                      e.target.value =
                        "";
                    }}
                  />
                  <ImageIcon
                    size={13}
                    className="shrink-0"
                  />
                  <span className="text-[11px] font-medium">
                    + Add cover
                  </span>
                  <span className="text-[10px] opacity-60">
                    — click to upload or
                    paste an image
                  </span>
                </div>
              )
            )}

            {/* Page icon */}
            {onUpdateFrontMatter && (
              <div
                className={`relative flex items-start gap-3 px-4 pt-4 pb-0 ${frontMatter?.cover ? "-mt-10" : ""}`}
              >
                <div className="relative shrink-0">
                  {frontMatter?.icon ? (
                    <button
                      onClick={() =>
                        setIconPickerOpen(
                          (o) => !o
                        )
                      }
                      className="text-5xl leading-none hover:bg-slate-800/60 rounded-xl p-1 transition cursor-pointer select-none"
                      title="Change icon"
                    >
                      {frontMatter.icon}
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        setIconPickerOpen(
                          (o) => !o
                        )
                      }
                      className="text-[11px] px-2 py-1 bg-slate-800/60 text-slate-500 hover:text-slate-300 rounded-lg transition cursor-pointer"
                    >
                      + icon
                    </button>
                  )}
                  {iconPickerOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() =>
                          setIconPickerOpen(
                            false
                          )
                        }
                      />
                      <div className="absolute top-12 left-0 z-50">
                        <EmojiPicker
                          theme={
                            Theme.DARK
                          }
                          onEmojiClick={(
                            emojiData
                          ) => {
                            onUpdateFrontMatter(
                              {
                                icon: emojiData.emoji
                              }
                            );
                            setIconPickerOpen(
                              false
                            );
                          }}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Page title — a separate element from the ProseMirror document
              body, driven by the Title page attribute instead of an
              editable first line. This keeps it outside the doc entirely:
              Ctrl+A / normal typing in the body can never touch it, and it
              can no longer be retitled (and the file silently renamed) by
              accident. Double-click to rename, or edit the Title field in
              Page Attributes above — both commit through the same
              commitTitleChange handler, so they can never drift apart.
              Shares getWidthClass() with the cover/icon header and the
              body content block above/below it, so the page-alignment
              control (left/center/full) moves the title along with
              everything else instead of leaving it pinned full-width. */}
          <div
            className={`px-4 pt-2 pb-1 ${getWidthClass()} transition-all duration-300`}
          >
            {titleDraft !== null ? (
              <input
                autoFocus
                value={titleDraft}
                onFocus={(e) =>
                  e.target.select()
                }
                onChange={(e) =>
                  setTitleDraft(
                    e.target.value
                  )
                }
                onBlur={() => {
                  if (
                    titleCancelRef.current
                  ) {
                    titleCancelRef.current =
                      false;
                  } else {
                    commitTitleChange(
                      titleDraft
                    );
                  }
                  setTitleDraft(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (
                      e.target as HTMLInputElement
                    ).blur();
                  } else if (
                    e.key === "Escape"
                  ) {
                    titleCancelRef.current =
                      true;
                    (
                      e.target as HTMLInputElement
                    ).blur();
                  }
                }}
                className="w-full bg-transparent text-slate-100 outline-none border-b-2 border-violet-500"
                style={{
                  fontSize: "2rem",
                  fontWeight: 800,
                  lineHeight: 1.2
                }}
              />
            ) : (
              <h1
                onDoubleClick={() => {
                  if (!onTitleChange)
                    return;
                  setTitleDraft(
                    frontMatter?.title ||
                      ""
                  );
                }}
                title={
                  onTitleChange
                    ? "Double-click to rename"
                    : undefined
                }
                className={`text-slate-100 select-none ${onTitleChange ? "cursor-text" : ""}`}
                style={{
                  fontSize: "2rem",
                  fontWeight: 800,
                  lineHeight: 1.2
                }}
              >
                {frontMatter?.title ||
                  "Untitled"}
              </h1>
            )}
          </div>

          {/* Document Content Block */}
          <div
            ref={editorWrapperRef}
            data-fontsize={
              editorFontSize
            }
            className={`flex-1 transition-all duration-300 ${getWidthClass()}`}
          >
            <EditorContent
              editor={editor}
            />
          </div>
        </div>
      </div>

      {/* TOC Sidebar Drawer */}
      {tocOpen && (
        <div className="w-60 border-l border-slate-800 bg-[#161b22]/70 backdrop-blur-md flex flex-col shrink-0 select-none animate-in slide-in-from-right duration-250">
          <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-[#161b22]">
            <div className="flex items-center gap-2">
              <BookOpen
                size={14}
                className="text-violet-400"
              />
              <h3 className="font-bold text-sm text-slate-200">
                Contents
              </h3>
            </div>
            <button
              onClick={() =>
                setTocOpen(false)
              }
              className="p-1 hover:bg-slate-800 rounded text-slate-500 hover:text-slate-300 transition cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 no-scrollbar">
            {tocHeadings.length ===
            0 ? (
              <p className="text-xs text-slate-500 italic py-4 text-center">
                No headings found.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {tocHeadings.map(
                  (h, i) => (
                    <li
                      key={i}
                      style={{
                        paddingLeft: `${(h.level - 1) * 12}px`
                      }}
                    >
                      <button
                        onClick={() => {
                          if (!editor)
                            return;
                          editor.commands.setTextSelection(
                            h.pos + 1
                          );
                          editor.view.focus();
                          const dom =
                            editor.view.nodeDOM(
                              h.pos
                            );
                          if (
                            dom instanceof
                            HTMLElement
                          )
                            dom.scrollIntoView(
                              {
                                behavior:
                                  "smooth",
                                block:
                                  "start"
                              }
                            );
                        }}
                        className="text-xs text-slate-400 hover:text-violet-400 hover:underline transition text-left w-full truncate leading-relaxed py-0.5"
                      >
                        {h.level >
                          1 && (
                          <span className="text-slate-600 mr-1">
                            {"–".repeat(
                              h.level -
                                1
                            )}
                          </span>
                        )}
                        {h.text}
                      </button>
                    </li>
                  )
                )}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Backlinks Sidebar Drawer */}
      {backlinksOpen && (
        <div className="w-72 border-l border-slate-800 bg-[#161b22]/70 backdrop-blur-md flex flex-col shrink-0 select-none animate-in slide-in-from-right duration-250">
          <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-[#161b22]">
            <div className="flex items-center gap-2">
              <LinkIcon
                size={14}
                className="text-violet-400"
              />
              <h3 className="font-bold text-sm text-slate-200">
                Backlinks
              </h3>
              {!backlinksLoading && (
                <span className="text-[10px] text-slate-500">
                  {backlinks.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={fetchBacklinks}
                disabled={
                  backlinksLoading
                }
                className="p-1 hover:bg-slate-800 rounded text-slate-500 hover:text-slate-300 transition cursor-pointer disabled:opacity-40"
                title="Refresh"
              >
                <RotateCcw size={12} />
              </button>
              <button
                onClick={() =>
                  setBacklinksOpen(
                    false
                  )
                }
                className="p-1 hover:bg-slate-800 rounded text-slate-500 hover:text-slate-300 transition cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 no-scrollbar space-y-2">
            {backlinksLoading ? (
              <div className="flex justify-center py-8 text-slate-500 text-xs">
                <Loader2
                  className="animate-spin mr-1.5"
                  size={14}
                />{" "}
                Scanning…
              </div>
            ) : backlinks.length ===
              0 ? (
              <p className="text-xs text-slate-500 italic py-6 text-center">
                No pages link to this
                page yet.
              </p>
            ) : (
              backlinks.map((bl, i) => (
                <div
                  key={i}
                  onClick={() => {
                    onSelectFile?.(
                      bl.path
                    );
                    setBacklinksOpen(
                      false
                    );
                  }}
                  className="p-2.5 bg-[#0d1117] border border-slate-800 rounded-lg hover:border-slate-700 transition cursor-pointer group"
                >
                  <div className="text-xs font-semibold text-slate-200 group-hover:text-violet-400 transition truncate mb-1">
                    {bl.title}
                  </div>
                  {bl.excerpt && (
                    <p className="text-[10px] text-slate-500 leading-relaxed line-clamp-2">
                      {bl.excerpt}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Version History Sidebar Drawer */}
      {historyOpen && (
        <div className="w-80 border-l border-slate-800 bg-[#161b22]/70 backdrop-blur-md flex flex-col shrink-0 select-none animate-in slide-in-from-right duration-250">
          <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-[#161b22]">
            <div className="flex items-center gap-2">
              <History
                size={16}
                className="text-violet-400"
              />
              <h3 className="font-bold text-sm text-slate-200">
                Version History
              </h3>
            </div>
            <button
              onClick={() =>
                setHistoryOpen(false)
              }
              className="p-1 hover:bg-slate-800 rounded text-slate-500 hover:text-slate-300 transition cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 no-scrollbar">
            {isLoadingHistory ? (
              <div className="flex justify-center py-10 text-slate-500 text-xs">
                <Loader2
                  className="animate-spin mr-1.5"
                  size={14}
                />{" "}
                Loading versions...
              </div>
            ) : historyList.length ===
              0 ? (
              <div className="text-center py-10 text-slate-500 text-xs">
                No rollback versions
                recorded yet.
                <br />
                <span className="text-[10px] text-slate-600 mt-2 block">
                  Versions are created
                  automatically when
                  changes are
                  auto-saved.
                </span>
              </div>
            ) : (
              historyList.map((ver) => (
                <div
                  key={ver.timestamp}
                  className="p-3 bg-[#0d1117] border border-slate-800 rounded-lg hover:border-slate-700 transition flex flex-col justify-between"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-semibold text-slate-300">
                      {ver.date}
                    </span>
                    <span className="text-[9px] font-mono text-slate-500">
                      {(
                        ver.size / 1024
                      ).toFixed(2)}{" "}
                      KB
                    </span>
                  </div>
                  <div className="mt-3.5 flex justify-end">
                    <button
                      onClick={() =>
                        handleLoadPreview(
                          ver.timestamp,
                          ver.date
                        )
                      }
                      disabled={
                        isPreviewLoading
                      }
                      className="flex items-center gap-1.5 px-3 py-1 bg-violet-600/10 hover:bg-violet-600 text-violet-400 hover:text-white border border-violet-500/20 rounded-md text-[10px] font-bold tracking-wide uppercase transition cursor-pointer disabled:opacity-50"
                    >
                      {isPreviewLoading ? (
                        <Loader2
                          className="animate-spin"
                          size={10}
                        />
                      ) : (
                        <RotateCcw
                          size={10}
                        />
                      )}
                      Preview & Rollback
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Floating Emoji Suggestions Popup Menu */}
      {emojiActive &&
        createPortal(
          <div
            ref={inlineEmojiPickerRef}
            data-editor-popover="true"
            style={{
              position: "fixed",
              top: `${emojiCoords.top}px`,
              left: `${emojiCoords.left}px`,
              zIndex: 9999,
              boxShadow:
                "0 8px 32px rgba(0,0,0,0.6)"
            }}
            onClick={(e) =>
              e.stopPropagation()
            }
            onMouseDown={(e) =>
              e.stopPropagation()
            }
          >
            <EmojiPicker
              theme={Theme.DARK}
              lazyLoadEmojis={true}
              onEmojiClick={(
                emojiData
              ) => {
                executeEmoji(
                  emojiData.emoji
                );
              }}
            />
          </div>,
          document.body
        )}

      {/* Bubble Formatting Menu — appears above selected text. Portaled to
          document.body (like every other floating popover in this app) so
          it stays genuinely viewport-relative regardless of any transformed
          ancestor between here and body — e.g. a Kanban card modal's own
          entrance-animation wrapper. */}
      {bubbleVisible && createPortal(
        <div
          ref={bubbleRef}
          style={{
            position: "fixed",
            top: `${bubbleCoords.top}px`,
            left: `${bubbleCoords.left}px`,
            zIndex: 9999
          }}
          className="flex items-center gap-0.5 px-1.5 py-1 bg-[#1a2236] border border-slate-700/80 rounded-xl shadow-2xl select-none animate-in fade-in zoom-in-95 duration-100"
          onMouseDown={(e) =>
            e.preventDefault()
          }
        >
          {[
            {
              mark: "bold",
              icon: <Bold size={13} />,
              title: "Bold (Ctrl+B)",
              action: () =>
                editor
                  .chain()
                  .focus()
                  .toggleBold()
                  .run()
            },
            {
              mark: "italic",
              icon: (
                <Italic size={13} />
              ),
              title: "Italic (Ctrl+I)",
              action: () =>
                editor
                  .chain()
                  .focus()
                  .toggleItalic()
                  .run()
            },
            {
              mark: "underline",
              icon: (
                <UnderlineIcon
                  size={13}
                />
              ),
              title:
                "Underline (Ctrl+U)",
              action: () =>
                editor
                  .chain()
                  .focus()
                  .toggleUnderline()
                  .run()
            },
            {
              mark: "strike",
              icon: (
                <Strikethrough
                  size={13}
                />
              ),
              title: "Strikethrough",
              action: () =>
                editor
                  .chain()
                  .focus()
                  .toggleStrike()
                  .run()
            },
            {
              mark: "subscript",
              icon: (
                <SubscriptIcon
                  size={13}
                />
              ),
              title: "Subscript",
              action: () =>
                editor
                  .chain()
                  .focus()
                  .toggleSubscript()
                  .run()
            },
            {
              mark: "superscript",
              icon: (
                <SuperscriptIcon
                  size={13}
                />
              ),
              title: "Superscript",
              action: () =>
                editor
                  .chain()
                  .focus()
                  .toggleSuperscript()
                  .run()
            },
            {
              mark: "code",
              icon: <Code size={13} />,
              title: "Inline Code",
              action: () =>
                editor
                  .chain()
                  .focus()
                  .toggleCode()
                  .run()
            }
          ].map(
            ({
              mark,
              icon,
              title,
              action
            }) => (
              <button
                key={mark}
                onClick={action}
                title={title}
                className={`p-1.5 rounded-lg transition ${
                  editor.isActive(mark)
                    ? "bg-violet-600/20 text-violet-400 border border-violet-500/30"
                    : "text-slate-300 hover:bg-slate-700/60 hover:text-white"
                }`}
              >
                {icon}
              </button>
            )
          )}
          <div className="w-px h-4 bg-slate-600/60 mx-0.5" />
          <button
            onClick={async () => {
              const attrs =
                editor.getAttributes(
                  "link"
                );
              if (attrs.href) {
                editor
                  .chain()
                  .focus()
                  .unsetLink()
                  .run();
              } else {
                const url =
                  await promptDialog(
                    "Enter the link URL:",
                    "",
                    {
                      title:
                        "Insert link",
                      placeholder:
                        "https://…",
                      confirmLabel:
                        "Insert"
                    }
                  );
                if (url)
                  editor
                    .chain()
                    .focus()
                    .setLink({
                      href: url
                    })
                    .run();
              }
            }}
            title="Link"
            className={`p-1.5 rounded-lg transition ${
              editor.isActive("link")
                ? "bg-violet-600/20 text-violet-400 border border-violet-500/30"
                : "text-slate-300 hover:bg-slate-700/60 hover:text-white"
            }`}
          >
            <Link2 size={13} />
          </button>
          <div className="w-px h-4 bg-slate-600/60 mx-0.5" />

          {/* Text color */}
          <div
            className="relative"
            data-color-picker
          >
            <button
              onClick={() => {
                setBubbleTextColorOpen(
                  (v) => !v
                );
                setBubbleBgColorOpen(
                  false
                );
              }}
              className={`p-1.5 rounded-lg transition flex items-center gap-0.5 ${
                bubbleTextColorOpen
                  ? "bg-violet-600/20 text-violet-400 border border-violet-500/30"
                  : "text-slate-300 hover:bg-slate-700/60 hover:text-white"
              }`}
              title="Text Color"
            >
              <span
                className="font-bold text-[11px] leading-none"
                style={{
                  color:
                    editor.getAttributes(
                      "textStyle"
                    ).color ||
                    "currentColor"
                }}
              >
                A
              </span>
              <ChevronDown
                size={9}
                className="opacity-60"
              />
            </button>
            {bubbleTextColorOpen && (
              <div
                className="absolute top-full left-0 mt-1 bg-[#1a2236] border border-slate-700 rounded-lg shadow-xl py-1.5 z-50 min-w-[160px]"
                data-color-picker
              >
                <div className="text-[10px] text-slate-500 mb-1 font-medium uppercase tracking-wider px-3">
                  Text color
                </div>
                {TEXT_COLORS.map(
                  (c) => {
                    const active =
                      c.value === null
                        ? !editor.getAttributes(
                            "textStyle"
                          ).color
                        : c.value ===
                          editor.getAttributes(
                            "textStyle"
                          ).color;
                    return (
                      <button
                        key={c.label}
                        onMouseDown={(
                          e
                        ) => {
                          e.preventDefault();
                          if (c.value)
                            editor
                              .chain()
                              .focus()
                              .setColor(
                                c.value
                              )
                              .run();
                          else
                            editor
                              .chain()
                              .focus()
                              .unsetColor()
                              .run();
                          setBubbleTextColorOpen(
                            false
                          );
                        }}
                        className={`w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-slate-700/50 transition text-left ${active ? "bg-slate-700/40" : ""}`}
                      >
                        <span
                          className="w-4 h-4 rounded-full border border-slate-600 shrink-0 flex items-center justify-center"
                          style={{
                            backgroundColor:
                              c.value ??
                              "transparent"
                          }}
                        >
                          {c.value ===
                            null && (
                            <span className="text-slate-400 text-[9px]">
                              ✕
                            </span>
                          )}
                        </span>
                        <span
                          className="text-sm"
                          style={{
                            color:
                              c.value ===
                              "#000000"
                                ? "#94a3b8"
                                : (c.value ??
                                  "#e2e8f0")
                          }}
                        >
                          {c.label}
                        </span>
                        {active && (
                          <span className="ml-auto text-violet-400 text-xs">
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  }
                )}
              </div>
            )}
          </div>

          {/* Background / highlight color */}
          <div
            className="relative"
            data-color-picker
          >
            <button
              onClick={() => {
                setBubbleBgColorOpen(
                  (v) => !v
                );
                setBubbleTextColorOpen(
                  false
                );
              }}
              className={`p-1.5 rounded-lg transition flex items-center gap-0.5 ${
                bubbleBgColorOpen
                  ? "bg-violet-600/20 text-violet-400 border border-violet-500/30"
                  : "text-slate-300 hover:bg-slate-700/60 hover:text-white"
              }`}
              title="Highlight / Background Color"
            >
              <span
                className="block w-3 h-3 rounded-sm border border-slate-600"
                style={{
                  backgroundColor:
                    editor.getAttributes(
                      "highlight"
                    ).color ||
                    "transparent"
                }}
              />
              <ChevronDown
                size={9}
                className="opacity-60"
              />
            </button>
            {bubbleBgColorOpen && (
              <div
                className="absolute top-full left-0 mt-1 bg-[#1a2236] border border-slate-700 rounded-lg shadow-xl py-1.5 z-50 min-w-[160px]"
                data-color-picker
              >
                <div className="text-[10px] text-slate-500 mb-1 font-medium uppercase tracking-wider px-3">
                  Highlight
                </div>
                {BG_COLORS.map(
                  (c) => {
                    const active =
                      c.value === null
                        ? !editor.getAttributes(
                            "highlight"
                          ).color
                        : c.value ===
                          editor.getAttributes(
                            "highlight"
                          ).color;
                    return (
                      <button
                        key={c.label}
                        onMouseDown={(
                          e
                        ) => {
                          e.preventDefault();
                          if (c.value)
                            editor
                              .chain()
                              .focus()
                              .setHighlight(
                                {
                                  color:
                                    c.value
                                }
                              )
                              .run();
                          else
                            editor
                              .chain()
                              .focus()
                              .unsetHighlight()
                              .run();
                          setBubbleBgColorOpen(
                            false
                          );
                        }}
                        className={`w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-slate-700/50 transition text-left ${active ? "bg-slate-700/40" : ""}`}
                      >
                        <span
                          className="w-4 h-4 rounded-sm border border-slate-600 shrink-0 flex items-center justify-center"
                          style={{
                            backgroundColor:
                              c.value ??
                              "transparent"
                          }}
                        >
                          {c.value ===
                            null && (
                            <span className="text-slate-400 text-[9px]">
                              ✕
                            </span>
                          )}
                        </span>
                        <span className="text-sm text-slate-200">
                          {c.label}
                        </span>
                        {active && (
                          <span className="ml-auto text-violet-400 text-xs">
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  }
                )}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Block menu (drag handle click) */}
      {blockMenu?.open &&
        editor &&
        (() => {
          const bpos = blockMenu.pos;
          const bnode =
            editor.state.doc.nodeAt(
              bpos
            );
          const nodeTypeName =
            bnode?.type.name ?? "";

          // ── Move block up/down ───────────────────────────────────────────
          const moveBlock = (
            dir: "up" | "down"
          ) => {
            const { state } = editor;
            const node =
              state.doc.nodeAt(bpos);
            if (!node) return;
            const blocks: {
              node: any;
              from: number;
            }[] = [];
            state.doc.forEach(
              (
                child: any,
                offset: number
              ) =>
                blocks.push({
                  node: child,
                  from: offset
                })
            );
            const idx =
              blocks.findIndex(
                (b) => b.from === bpos
              );
            if (idx === -1) return;
            const swapIdx =
              dir === "up"
                ? idx - 1
                : idx + 1;
            if (
              swapIdx < 0 ||
              swapIdx >= blocks.length
            )
              return;
            const cur = blocks[idx],
              swap = blocks[swapIdx];
            const from = Math.min(
              cur.from,
              swap.from
            );
            const to =
              Math.max(
                cur.from,
                swap.from
              ) +
              (dir === "up"
                ? swap
                : cur
              ).node.nodeSize;
            const newPos =
              (dir === "up"
                ? cur
                : swap
              ).from + 1;
            const tr =
              state.tr.replaceWith(
                from,
                to,
                dir === "up"
                  ? [
                      cur.node,
                      swap.node
                    ]
                  : [
                      swap.node,
                      cur.node
                    ]
              );
            tr.setSelection(
              (
                state.selection
                  .constructor as any
              ).near(
                tr.doc.resolve(newPos)
              )
            );
            editor.view.dispatch(tr);
            setBlockMenu(null);
          };

          // ── Insert paragraph ─────────────────────────────────────────────
          const insertBlock = (
            dir: "above" | "below"
          ) => {
            const node =
              editor.state.doc.nodeAt(
                bpos
              );
            if (!node) return;
            editor
              .chain()
              .focus()
              .insertContentAt(
                dir === "above"
                  ? bpos
                  : bpos +
                      node.nodeSize,
                { type: "paragraph" }
              )
              .run();
            setBlockMenu(null);
          };

          // ── Transform block type ─────────────────────────────────────────
          const transform = (
            type: string
          ) => {
            editor
              .chain()
              .focus()
              .setTextSelection(
                bpos + 1
              )
              .run();
            switch (type) {
              case "paragraph":
                editor
                  .chain()
                  .focus()
                  .setParagraph()
                  .run();
                break;
              case "h1":
                editor
                  .chain()
                  .focus()
                  .setHeading({
                    level: 1
                  })
                  .run();
                break;
              case "h2":
                editor
                  .chain()
                  .focus()
                  .setHeading({
                    level: 2
                  })
                  .run();
                break;
              case "h3":
                editor
                  .chain()
                  .focus()
                  .setHeading({
                    level: 3
                  })
                  .run();
                break;
              case "h4":
                editor
                  .chain()
                  .focus()
                  .setHeading({
                    level: 4
                  })
                  .run();
                break;
              case "bulletList":
                editor
                  .chain()
                  .focus()
                  .toggleBulletList()
                  .run();
                break;
              case "orderedList":
                editor
                  .chain()
                  .focus()
                  .toggleOrderedList()
                  .run();
                break;
              case "taskList":
                editor
                  .chain()
                  .focus()
                  .toggleTaskList()
                  .run();
                break;
              case "blockquote":
                editor
                  .chain()
                  .focus()
                  .toggleBlockquote()
                  .run();
                break;
              case "codeBlock":
                editor
                  .chain()
                  .focus()
                  .toggleCodeBlock()
                  .run();
                break;
            }
            setBlockMenu(null);
          };

          // ── Apply text/background color to entire block ──────────────────
          const applyColor = (
            color: string | null,
            mode: "text" | "bg"
          ) => {
            const node =
              editor.state.doc.nodeAt(
                bpos
              );
            if (!node) return;
            const from = bpos + 1,
              to =
                bpos +
                node.nodeSize -
                1;
            if (mode === "text") {
              editor
                .chain()
                .focus()
                .setTextSelection({
                  from,
                  to
                })
                .run();
              color
                ? editor
                    .chain()
                    .focus()
                    .setColor(color)
                    .run()
                : editor
                    .chain()
                    .focus()
                    .unsetColor()
                    .run();
            } else {
              editor
                .chain()
                .focus()
                .setTextSelection({
                  from,
                  to
                })
                .run();
              color
                ? editor
                    .chain()
                    .focus()
                    .setHighlight({
                      color
                    })
                    .run()
                : editor
                    .chain()
                    .focus()
                    .unsetHighlight()
                    .run();
            }
            setBlockMenu(null);
          };

          // ── Top-level detection for move buttons ─────────────────────────
          const topOffsets: number[] =
            [];
          editor.state.doc.forEach(
            (_: any, off: number) =>
              topOffsets.push(off)
          );
          const topIdx =
            topOffsets.indexOf(bpos);
          const canMoveUp = topIdx > 0;
          const canMoveDown =
            topIdx !== -1 &&
            topIdx <
              topOffsets.length - 1;

          // ── Layout calculations ───────────────────────────────────────────
          const MAIN_W = 192;
          const SUB_W = 228;
          const menuLeft = Math.max(
            4,
            blockMenu.coords.left -
              MAIN_W -
              8
          );
          const rawSubLeft =
            menuLeft + MAIN_W + 4;
          const subLeft =
            rawSubLeft + SUB_W >
            window.innerWidth - 8
              ? menuLeft - SUB_W - 4
              : rawSubLeft;
          const menuTop = Math.min(
            blockMenu.coords.top - 8,
            window.innerHeight - 360
          );
          const subTop = Math.min(
            blockMenu.coords.top - 8,
            window.innerHeight - 360
          );

          // ── Shared menu item classes ──────────────────────────────────────
          const item =
            "flex items-center gap-2.5 w-full px-3 py-[7px] text-[12.5px] text-slate-300 hover:bg-white/5 transition rounded-md cursor-pointer select-none";
          const itemActive =
            "bg-white/8 text-white";
          const itemRed =
            "flex items-center gap-2.5 w-full px-3 py-[7px] text-[12.5px] text-red-400 hover:bg-red-500/10 transition rounded-md cursor-pointer select-none";
          const sep = (
            <div className="mx-2 my-1 h-px bg-white/8" />
          );

          const TRANSFORMS: {
            id: string;
            label: string;
            icon: any;
            shortcut?: string;
          }[] = [
            {
              id: "paragraph",
              label: "Text",
              icon: Type,
              shortcut: "Ctrl+Alt+0"
            },
            {
              id: "h1",
              label: "Heading 1",
              icon: Heading1,
              shortcut: "Ctrl+Alt+1"
            },
            {
              id: "h2",
              label: "Heading 2",
              icon: Heading2,
              shortcut: "Ctrl+Alt+2"
            },
            {
              id: "h3",
              label: "Heading 3",
              icon: Heading3,
              shortcut: "Ctrl+Alt+3"
            },
            {
              id: "h4",
              label: "Heading 4",
              icon: Heading3,
              shortcut: "Ctrl+Alt+4"
            },
            {
              id: "bulletList",
              label: "Bulleted list",
              icon: List,
              shortcut: "Ctrl+Shift+9"
            },
            {
              id: "orderedList",
              label: "Numbered list",
              icon: ListOrdered,
              shortcut: "Ctrl+Shift+7"
            },
            {
              id: "taskList",
              label: "Checklist",
              icon: CheckSquare,
              shortcut: "Ctrl+Shift+8"
            },
            {
              id: "blockquote",
              label: "Quote",
              icon: Quote
            },
            {
              id: "codeBlock",
              label: "Code Block",
              icon: Code2
            }
          ];

          const isCurrent = (
            id: string
          ) => {
            if (
              id === "paragraph" &&
              nodeTypeName ===
                "paragraph"
            )
              return true;
            if (
              (id === "h1" ||
                id === "h2" ||
                id === "h3" ||
                id === "h4") &&
              nodeTypeName ===
                "heading" &&
              bnode?.attrs?.level ===
                Number(id.slice(1))
            )
              return true;
            if (
              id === "bulletList" &&
              nodeTypeName ===
                "bulletList"
            )
              return true;
            if (
              id === "orderedList" &&
              nodeTypeName ===
                "orderedList"
            )
              return true;
            if (
              id === "taskList" &&
              nodeTypeName ===
                "taskList"
            )
              return true;
            if (
              id === "blockquote" &&
              nodeTypeName ===
                "blockquote"
            )
              return true;
            if (
              id === "codeBlock" &&
              nodeTypeName ===
                "codeBlock"
            )
              return true;
            return false;
          };

          const openSub = (
            s: "transform" | "color"
          ) =>
            setBlockMenu((m) =>
              m
                ? { ...m, submenu: s }
                : m
            );
          const closeSub = () =>
            setBlockMenu((m) =>
              m
                ? {
                    ...m,
                    submenu: null
                  }
                : m
            );

          return (
            <>
              {/* ── Main menu ──────────────────────────────────────────── */}
              <div
                data-block-menu
                style={{
                  position: "fixed",
                  top: menuTop,
                  left: menuLeft,
                  width: MAIN_W,
                  zIndex: 9999
                }}
                className="bg-[#1c2330] border border-white/10 rounded-xl shadow-2xl py-1.5 px-1.5 flex flex-col select-none animate-in fade-in zoom-in-95 duration-100"
              >
                <div className="px-2 pb-1 pt-0.5 text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                  Options
                </div>

                <button
                  className={`${item} ${blockMenu.submenu === "transform" ? itemActive : ""}`}
                  onMouseEnter={() =>
                    openSub("transform")
                  }
                >
                  <Repeat2
                    size={13}
                    className="text-slate-400 shrink-0"
                  />
                  <span className="flex-1 text-left">
                    Turn into
                  </span>
                  <ChevronRight
                    size={11}
                    className="text-slate-500 shrink-0"
                  />
                </button>

                <button
                  className={`${item} ${blockMenu.submenu === "color" ? itemActive : ""}`}
                  onMouseEnter={() =>
                    openSub("color")
                  }
                >
                  <Palette
                    size={13}
                    className="text-slate-400 shrink-0"
                  />
                  <span className="flex-1 text-left">
                    Color
                  </span>
                  <ChevronRight
                    size={11}
                    className="text-slate-500 shrink-0"
                  />
                </button>

                {sep}

                <button
                  className={item}
                  onMouseEnter={
                    closeSub
                  }
                  onClick={() => {
                    if (bnode)
                      editor
                        .chain()
                        .focus()
                        .insertContentAt(
                          bpos +
                            bnode.nodeSize,
                          bnode.toJSON()
                        )
                        .run();
                    setBlockMenu(null);
                  }}
                >
                  <Copy
                    size={13}
                    className="text-slate-400 shrink-0"
                  />
                  Duplicate
                </button>

                {sep}

                <button
                  className={`${item} ${!canMoveUp ? "opacity-30 cursor-not-allowed" : ""}`}
                  onMouseEnter={
                    closeSub
                  }
                  disabled={!canMoveUp}
                  onClick={() =>
                    moveBlock("up")
                  }
                >
                  <ArrowUp
                    size={13}
                    className="text-slate-400 shrink-0"
                  />{" "}
                  Move up
                </button>
                <button
                  className={`${item} ${!canMoveDown ? "opacity-30 cursor-not-allowed" : ""}`}
                  onMouseEnter={
                    closeSub
                  }
                  disabled={
                    !canMoveDown
                  }
                  onClick={() =>
                    moveBlock("down")
                  }
                >
                  <ArrowDown
                    size={13}
                    className="text-slate-400 shrink-0"
                  />{" "}
                  Move down
                </button>

                {sep}

                <button
                  className={item}
                  onMouseEnter={
                    closeSub
                  }
                  onClick={() =>
                    insertBlock("above")
                  }
                >
                  <Plus
                    size={13}
                    className="text-slate-400 shrink-0"
                  />{" "}
                  Insert above
                </button>
                <button
                  className={item}
                  onMouseEnter={
                    closeSub
                  }
                  onClick={() =>
                    insertBlock("below")
                  }
                >
                  <Plus
                    size={13}
                    className="text-slate-400 shrink-0"
                  />{" "}
                  Insert below
                </button>

                {sep}

                <button
                  className={itemRed}
                  onMouseEnter={
                    closeSub
                  }
                  onClick={() => {
                    editor
                      .chain()
                      .focus()
                      .deleteRange({
                        from: bpos,
                        to:
                          bpos +
                          (bnode?.nodeSize ??
                            1)
                      })
                      .run();
                    setBlockMenu(null);
                  }}
                >
                  <Trash2
                    size={13}
                    className="shrink-0"
                  />
                  <span className="flex-1 text-left">
                    Delete
                  </span>
                  <span className="text-[10px] text-red-600/70 font-mono">
                    Del
                  </span>
                </button>
              </div>

              {/* ── Transform submenu ──────────────────────────────────── */}
              {blockMenu.submenu ===
                "transform" && (
                <div
                  data-block-menu
                  style={{
                    position: "fixed",
                    top: subTop,
                    left: subLeft,
                    width: SUB_W,
                    zIndex: 9999
                  }}
                  className="bg-[#1c2330] border border-white/10 rounded-xl shadow-2xl py-1.5 px-1.5 flex flex-col select-none animate-in fade-in zoom-in-95 duration-100"
                  onMouseEnter={() =>
                    openSub("transform")
                  }
                >
                  <div className="px-2 pb-1 pt-0.5 text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                    Turn into
                  </div>
                  {TRANSFORMS.map(
                    (t) => {
                      const Icon =
                        t.icon;
                      const active =
                        isCurrent(t.id);
                      return (
                        <button
                          key={t.id}
                          onClick={() =>
                            transform(
                              t.id
                            )
                          }
                          className={`flex items-center gap-2.5 w-full px-3 py-[7px] text-[12.5px] transition rounded-md cursor-pointer ${active ? "bg-violet-500/15 text-violet-300" : "text-slate-300 hover:bg-white/5"}`}
                        >
                          <Icon
                            size={14}
                            className={
                              active
                                ? "text-violet-400"
                                : "text-slate-400"
                            }
                          />
                          <span className="flex-1 text-left">
                            {t.label}
                          </span>
                          {active && (
                            <Check
                              size={11}
                              className="text-violet-400 shrink-0"
                            />
                          )}
                          {!active &&
                            t.shortcut && (
                              <span className="text-[10px] text-slate-600 font-mono shrink-0">
                                {
                                  t.shortcut
                                }
                              </span>
                            )}
                        </button>
                      );
                    }
                  )}
                </div>
              )}

              {/* ── Color submenu ───────────────────────────────────────── */}
              {blockMenu.submenu ===
                "color" && (
                <div
                  data-block-menu
                  style={{
                    position: "fixed",
                    top: subTop,
                    left: subLeft,
                    width: SUB_W,
                    zIndex: 9999
                  }}
                  className="bg-[#1c2330] border border-white/10 rounded-xl shadow-2xl py-2 px-2 select-none animate-in fade-in zoom-in-95 duration-100"
                  onMouseEnter={() =>
                    openSub("color")
                  }
                >
                  <div className="px-1 pb-1.5 pt-0.5 text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                    Text color
                  </div>
                  <div className="flex flex-wrap gap-1.5 px-1 pb-2">
                    {TEXT_COLORS.map(
                      (c) => (
                        <button
                          key={c.label}
                          title={
                            c.label
                          }
                          onClick={() =>
                            applyColor(
                              c.value,
                              "text"
                            )
                          }
                          className="w-6 h-6 rounded-md border border-white/10 flex items-center justify-center hover:scale-110 transition cursor-pointer"
                          style={{
                            background:
                              c.value ??
                              "transparent"
                          }}
                        >
                          {!c.value && (
                            <span className="text-slate-500 text-[10px] font-bold leading-none">
                              A
                            </span>
                          )}
                        </button>
                      )
                    )}
                  </div>
                  <div className="h-px bg-white/8 mx-1 mb-2" />
                  <div className="px-1 pb-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                    Background
                  </div>
                  <div className="flex flex-wrap gap-1.5 px-1 pb-1">
                    {BG_COLORS.map(
                      (c) => (
                        <button
                          key={c.label}
                          title={
                            c.label
                          }
                          onClick={() =>
                            applyColor(
                              c.value,
                              "bg"
                            )
                          }
                          className="w-6 h-6 rounded-md border border-white/10 flex items-center justify-center hover:scale-110 transition cursor-pointer"
                          style={{
                            background:
                              c.value ??
                              "transparent"
                          }}
                        >
                          {!c.value && (
                            <span className="text-slate-600 text-[10px] font-bold leading-none">
                              ✕
                            </span>
                          )}
                        </button>
                      )
                    )}
                  </div>
                </div>
              )}
            </>
          );
        })()}

      {/* Right-click context menu */}
      {contextMenu?.open && editor && (
        <div
          data-context-menu
          onContextMenu={e => e.preventDefault()}
          style={{
            position: "fixed",
            top: `${contextMenu.coords.top}px`,
            left: `${contextMenu.coords.left}px`,
            zIndex: 9999
          }}
          className="w-44 bg-[#161b22] border border-slate-700/80 rounded-xl shadow-2xl p-1.5 flex flex-col space-y-0.5 select-none animate-in fade-in zoom-in-95 duration-100"
        >
          <button
            onClick={() => {
              editor
                .chain()
                .focus()
                .setTextSelection(
                  contextMenu.pos
                )
                .run();
              document.execCommand(
                "copy"
              );
              setContextMenu(null);
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-slate-700/60 transition cursor-pointer"
          >
            <Copy size={12} /> Copy
          </button>
          <button
            onClick={() => {
              const html =
                editor.getHTML();
              const md =
                turndownService.turndown(
                  html
                );
              navigator.clipboard.writeText(
                md
              );
              setContextMenu(null);
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-slate-700/60 transition cursor-pointer"
          >
            <FileText size={12} /> Copy
            as Markdown
          </button>
          <div className="w-full h-px bg-slate-800 my-0.5" />
          <button
            onClick={() => {
              const node =
                editor.state.doc.nodeAt(
                  contextMenu.pos
                );
              if (node) {
                editor
                  .chain()
                  .focus()
                  .deleteRange({
                    from: contextMenu.pos,
                    to:
                      contextMenu.pos +
                      node.nodeSize
                  })
                  .run();
              }
              setContextMenu(null);
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-red-400 hover:bg-red-500/10 transition cursor-pointer"
          >
            <Trash2 size={12} /> Delete
            block
          </button>
        </div>
      )}

      {/* Internal link hover preview */}
      {/* Math formula edit / insert popover */}
      {mathEdit &&
        (() => {
          const isInsert =
            mathEdit.pos === -1;
          const applyMath = () => {
            const latex =
              mathEditDraft.trim();
            if (!latex) {
              setMathEdit(null);
              return;
            }
            if (isInsert) {
              (
                editor
                  .chain()
                  .focus() as any
              )
                .insertInlineMath({
                  latex
                })
                .run();
            } else {
              (
                editor
                  .chain()
                  .focus() as any
              )
                .updateInlineMath({
                  pos: mathEdit.pos,
                  latex
                })
                .run();
            }
            setMathEdit(null);
          };
          return (
            <div
              style={{
                position: "fixed",
                top: `${mathEdit.y}px`,
                left: `${Math.min(mathEdit.x, window.innerWidth - 340)}px`,
                zIndex: 10000
              }}
              className="w-80 bg-[#161b22] border border-violet-500/40 rounded-xl shadow-2xl p-3 animate-in fade-in zoom-in-95 duration-100"
              onMouseDown={(e) =>
                e.stopPropagation()
              }
            >
              <div className="text-[10px] font-semibold text-slate-400 mb-1.5 flex items-center gap-1.5">
                <span className="text-violet-400">
                  ∑
                </span>
                {isInsert
                  ? "Insert LaTeX formula"
                  : "Edit LaTeX formula"}
              </div>
              <input
                autoFocus
                value={mathEditDraft}
                onChange={(e) =>
                  setMathEditDraft(
                    e.target.value
                  )
                }
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter"
                  ) {
                    e.preventDefault();
                    applyMath();
                  }
                  if (
                    e.key === "Escape"
                  )
                    setMathEdit(null);
                }}
                className="w-full bg-[#0d1117] border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm font-mono text-slate-200 outline-none focus:border-violet-500 mb-2"
                placeholder="E = mc^2"
              />
              <div className="flex gap-2">
                <button
                  onClick={applyMath}
                  className="flex-1 text-[11px] px-2 py-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-500 transition cursor-pointer font-medium"
                >
                  {isInsert
                    ? "Insert"
                    : "Apply"}{" "}
                  (Enter)
                </button>
                {!isInsert && (
                  <button
                    onClick={() => {
                      (
                        editor
                          .chain()
                          .focus() as any
                      )
                        .deleteInlineMath(
                          {
                            pos: mathEdit.pos
                          }
                        )
                        .run();
                      setMathEdit(null);
                    }}
                    className="text-[11px] px-2 py-1.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition cursor-pointer"
                  >
                    Delete
                  </button>
                )}
                <button
                  onClick={() =>
                    setMathEdit(null)
                  }
                  className="text-[11px] px-2 py-1.5 bg-slate-800 text-slate-400 rounded-lg hover:bg-slate-700 transition cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          );
        })()}

      {/* "/date" calendar picker popover */}
      {dateEdit &&
        (() => {
          const applyDate = () => {
            if (!dateEditDraft) {
              setDateEdit(null);
              return;
            }
            const [y, m, day] =
              dateEditDraft
                .split("-")
                .map(Number);
            const picked = new Date(
              y,
              m - 1,
              day
            );
            editor
              .chain()
              .focus()
              .insertContent(
                formatDisplayDate(
                  picked,
                  dateFormat
                ) + " "
              )
              .run();
            setDateEdit(null);
          };
          return (
            <div
              style={{
                position: "fixed",
                top: `${dateEdit.y}px`,
                left: `${Math.min(dateEdit.x, window.innerWidth - 260)}px`,
                zIndex: 10000
              }}
              className="w-60 bg-[#161b22] border border-violet-500/40 rounded-xl shadow-2xl p-3 animate-in fade-in zoom-in-95 duration-100"
              onMouseDown={(e) =>
                e.stopPropagation()
              }
            >
              <div className="text-[10px] font-semibold text-slate-400 mb-1.5 flex items-center gap-1.5">
                <Calendar
                  size={12}
                  className="text-violet-400"
                />
                Pick a date
              </div>
              <input
                ref={dateInputRef}
                data-testid="slash-date-picker-input"
                autoFocus
                type="date"
                value={dateEditDraft}
                onChange={(e) =>
                  setDateEditDraft(
                    e.target.value
                  )
                }
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter"
                  ) {
                    e.preventDefault();
                    applyDate();
                  }
                  if (
                    e.key === "Escape"
                  )
                    setDateEdit(null);
                }}
                className="w-full bg-[#0d1117] border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-slate-200 outline-none focus:border-violet-500 mb-2 [color-scheme:dark]"
              />
              <div className="flex gap-2">
                <button
                  onClick={applyDate}
                  className="flex-1 text-[11px] px-2 py-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-500 transition cursor-pointer font-medium"
                >
                  Insert (Enter)
                </button>
                <button
                  onClick={() =>
                    setDateEdit(null)
                  }
                  className="text-[11px] px-2 py-1.5 bg-slate-800 text-slate-400 rounded-lg hover:bg-slate-700 transition cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          );
        })()}

      {linkPreview && (
        <div
          style={{
            position: "fixed",
            top: `${linkPreview.coords.top}px`,
            left: `${linkPreview.coords.left}px`,
            zIndex: 9999
          }}
          className="w-64 bg-[#161b22] border border-slate-700/80 rounded-xl shadow-2xl p-3 pointer-events-none animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="text-xs font-semibold text-slate-200 mb-1 truncate">
            {linkPreview.title}
          </div>
          {linkPreview.excerpt ? (
            <p className="text-[10px] text-slate-500 leading-relaxed line-clamp-3">
              {linkPreview.excerpt}
            </p>
          ) : (
            <p className="text-[10px] text-slate-600 italic">
              No content preview
              available.
            </p>
          )}
        </div>
      )}

      {/* Floating Slash Command Popup Menu */}
      {commandActive &&
        filteredList.length > 0 &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: `${commandCoords.top}px`,
              left: `${commandCoords.left}px`,
              zIndex: 9999
            }}
            ref={commandListRef}
            data-editor-popover="true"
            className="w-64 max-h-72 overflow-y-auto bg-[#161b22] border border-slate-700/80 rounded-xl shadow-2xl p-1.5 flex flex-col space-y-0.5 no-scrollbar select-none"
          >
            <div className="px-2.5 py-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-wider">
              Basic Blocks
            </div>
            {filteredList.map(
              (cmd, i) => {
                const isSelected =
                  i === selectedIndex;
                return (
                  <div
                    key={cmd.id}
                    data-cmd-idx={i}
                    onClick={() =>
                      executeCommand(
                        cmd.id
                      )
                    }
                    onMouseEnter={() =>
                      setSelectedIndex(
                        i
                      )
                    }
                    className={`flex items-start gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition ${
                      isSelected
                        ? "bg-violet-600/10 text-violet-400 border border-violet-500/20"
                        : "text-slate-300"
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {getCommandIcon(
                        cmd.id,
                        isSelected
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-xs leading-none mb-0.5">
                          {cmd.label}
                        </span>
                        {cmd.shortcut && (
                          <span className="text-[9px] font-mono text-slate-600 bg-slate-800 px-1 py-0.5 rounded shrink-0">
                            {
                              cmd.shortcut
                            }
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 leading-tight">
                        {cmd.desc}
                      </div>
                    </div>
                  </div>
                );
              }
            )}
          </div>,
          document.body
        )}

      {/* Floating Mention Popup Menu */}
      {mentionActive &&
        getFilteredMentions().length >
          0 &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: `${mentionCoords.top}px`,
              left: `${mentionCoords.left}px`,
              zIndex: 9999
            }}
            data-editor-popover="true"
            className="w-80 max-h-72 overflow-y-auto bg-[#161b22] border border-slate-700/80 rounded-xl shadow-2xl p-1.5 flex flex-col space-y-0.5 no-scrollbar select-none animate-in fade-in zoom-in-95 duration-100"
          >
            <div className="px-2.5 py-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-800/40 mb-1">
              Link to Page
            </div>
            {getFilteredMentions().map(
              (file, i) => {
                const isSelected =
                  i ===
                  mentionSelectedIndex;
                const icon =
                  getFileIcon(
                    file.type
                  );
                return (
                  <div
                    key={file.path}
                    onClick={() =>
                      executeMention(
                        file
                      )
                    }
                    onMouseEnter={() =>
                      setMentionSelectedIndex(
                        i
                      )
                    }
                    className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition ${
                      isSelected
                        ? "bg-violet-600/15 text-violet-300 border border-violet-500/20"
                        : "text-slate-300 hover:bg-slate-800/40"
                    }`}
                  >
                    <div className="shrink-0">
                      {icon}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-semibold truncate">
                        {file.title ||
                          file.path
                            .split("/")
                            .pop() ||
                          "Untitled"}
                      </span>
                      <span className="text-[9px] text-slate-500 font-mono truncate">
                        {file.path}
                      </span>
                    </div>
                  </div>
                );
              }
            )}
          </div>,
          document.body
        )}

      {mentionActive &&
        getFilteredMentions().length ===
          0 &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: `${mentionCoords.top}px`,
              left: `${mentionCoords.left}px`,
              zIndex: 9999
            }}
            data-editor-popover="true"
            className="w-80 bg-[#161b22] border border-slate-700/80 rounded-xl shadow-2xl p-3 text-center text-slate-500 text-xs select-none"
          >
            No matching pages found
          </div>,
          document.body
        )}

      {editingImageSrc && (
        <ImageEditorModal
          src={getRelativePath(
            editingImageSrc
          )}
          notePath={filePath}
          apiBase={API_BASE}
          onClose={() =>
            setEditingImageSrc(null)
          }
          onSave={handleImageSave}
        />
      )}

      {slideshowOpen && editor && (
        <Slideshow
          markdown={turndownService.turndown(
            editor.getHTML()
          )}
          title={filePath
            .split("/")
            .pop()
            ?.replace(/\.md$/, "")}
          onClose={() =>
            setSlideshowOpen(false)
          }
        />
      )}

      {embedModalOpen &&
        createPortal(
          <div
            data-editor-popover="true"
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm transition-opacity"
          >
            <div className="bg-[#161b22] border border-slate-700/80 rounded-2xl shadow-2xl p-6 max-w-md w-full text-slate-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-md font-bold tracking-wide flex items-center gap-2">
                  <svg
                    className="w-5 h-5 text-violet-400"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
                    />
                  </svg>
                  Insert Rich Embed
                </h3>
                <button
                  onClick={() =>
                    setEmbedModalOpen(
                      false
                    )
                  }
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Type selector tabs */}
              <div className="flex gap-2 p-1 bg-[#0d1117] rounded-xl mb-5 border border-slate-800/80">
                <button
                  onClick={() =>
                    setEmbedType("url")
                  }
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    embedType === "url"
                      ? "bg-violet-600 text-white shadow-md"
                      : "text-slate-455 hover:text-slate-200"
                  }`}
                >
                  Website URL / Iframe
                </button>
                <button
                  onClick={() => {
                    setEmbedType(
                      "drawio"
                    );
                    const canvasFiles =
                      wsFiles.filter(
                        (f) =>
                          f.type ===
                          "canvas"
                      );
                    if (
                      canvasFiles.length >
                        0 &&
                      !selectedCanvasPath
                    ) {
                      setSelectedCanvasPath(
                        canvasFiles[0]
                          .path
                      );
                    }
                  }}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    embedType ===
                    "drawio"
                      ? "bg-violet-600 text-white shadow-md"
                      : "text-slate-455 hover:text-slate-200"
                  }`}
                >
                  Canvas Drawing
                </button>
                <button
                  onClick={() => {
                    setEmbedType(
                      "mindmap"
                    );
                    const mindmapFiles =
                      wsFiles.filter(
                        (f) =>
                          f.type ===
                          "mindmap"
                      );
                    if (
                      mindmapFiles.length >
                        0 &&
                      !selectedMindmapPath
                    ) {
                      setSelectedMindmapPath(
                        mindmapFiles[0]
                          .path
                      );
                    }
                  }}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    embedType ===
                    "mindmap"
                      ? "bg-violet-600 text-white shadow-md"
                      : "text-slate-455 hover:text-slate-200"
                  }`}
                >
                  Mind Map
                </button>
              </div>

              {/* Content panel */}
              <div className="space-y-4 mb-6">
                {embedType === "url" ? (
                  <div>
                    <label className="block text-xs font-semibold text-slate-455 mb-1.5 uppercase tracking-wider">
                      Embed Link / URL
                    </label>
                    <input
                      type="text"
                      value={embedUrl}
                      onChange={(e) =>
                        setEmbedUrl(
                          e.target.value
                        )
                      }
                      placeholder="e.g. https://youtube.com/watch?v=... or https://example.com"
                      className="w-full bg-[#0d1117] border border-slate-750 rounded-xl px-3.5 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-violet-500/80 focus:ring-1 focus:ring-violet-500/30 transition placeholder-slate-655"
                    />
                    <p className="text-[10px] text-slate-500 mt-1.5 font-medium">
                      Supports regular
                      websites, direct
                      iframe src URLs,
                      YouTube videos,
                      and more.
                    </p>
                  </div>
                ) : embedType ===
                  "drawio" ? (
                  <div>
                    <label className="block text-xs font-semibold text-slate-455 mb-1.5 uppercase tracking-wider">
                      Select Workspace
                      Drawing
                    </label>
                    {wsFiles.filter(
                      (f) =>
                        f.type ===
                        "canvas"
                    ).length > 0 ? (
                      <select
                        value={
                          selectedCanvasPath
                        }
                        onChange={(e) =>
                          setSelectedCanvasPath(
                            e.target
                              .value
                          )
                        }
                        className="w-full bg-[#0d1117] border border-slate-750 rounded-xl px-3.5 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-violet-500/80 focus:ring-1 focus:ring-violet-500/30 transition cursor-pointer"
                      >
                        {wsFiles
                          .filter(
                            (f) =>
                              f.type ===
                              "canvas"
                          )
                          .map((f) => (
                            <option
                              key={
                                f.path
                              }
                              value={
                                f.path
                              }
                            >
                              {f.title ||
                                f.path
                                  .split(
                                    "/"
                                  )
                                  .pop()}{" "}
                              (
                              {f
                                .frontMatter
                                ?.editor ===
                              "drawio"
                                ? "Draw.io"
                                : "Excalidraw"}
                              )
                            </option>
                          ))}
                      </select>
                    ) : (
                      <div className="text-center py-4 bg-[#0d1117] border border-slate-800 rounded-xl select-none">
                        <p className="text-xs text-slate-500 font-medium">
                          No canvas
                          drawings found
                          in this
                          workspace.
                        </p>
                        <p className="text-[10px] text-slate-600 mt-1">
                          Create an
                          Excalidraw or
                          Draw.io canvas
                          page from the
                          sidebar menu
                          first.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-slate-455 mb-1.5 uppercase tracking-wider">
                      Select Mind Map
                    </label>
                    {wsFiles.filter(
                      (f) =>
                        f.type ===
                        "mindmap"
                    ).length > 0 ? (
                      <select
                        value={
                          selectedMindmapPath
                        }
                        onChange={(e) =>
                          setSelectedMindmapPath(
                            e.target
                              .value
                          )
                        }
                        className="w-full bg-[#0d1117] border border-slate-750 rounded-xl px-3.5 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-violet-500/80 focus:ring-1 focus:ring-violet-500/30 transition cursor-pointer"
                      >
                        {wsFiles
                          .filter(
                            (f) =>
                              f.type ===
                              "mindmap"
                          )
                          .map((f) => (
                            <option
                              key={
                                f.path
                              }
                              value={
                                f.path
                              }
                            >
                              {f.title ||
                                f.path
                                  .split(
                                    "/"
                                  )
                                  .pop()
                                  ?.replace(
                                    ".mindmap.md",
                                    ""
                                  )}
                            </option>
                          ))}
                      </select>
                    ) : (
                      <div className="text-center py-4 bg-[#0d1117] border border-slate-800 rounded-xl select-none">
                        <p className="text-xs text-slate-500 font-medium">
                          No mind maps
                          found in this
                          workspace.
                        </p>
                        <p className="text-[10px] text-slate-600 mt-1">
                          Create a mind
                          map from the
                          sidebar first.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 select-none">
                <button
                  onClick={() =>
                    setEmbedModalOpen(
                      false
                    )
                  }
                  className="px-4 py-2 border border-slate-800 hover:bg-slate-800 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={
                    handleInsertEmbed
                  }
                  disabled={
                    (embedType ===
                      "drawio" &&
                      wsFiles.filter(
                        (f) =>
                          f.type ===
                          "canvas"
                      ).length === 0) ||
                    (embedType ===
                      "mindmap" &&
                      wsFiles.filter(
                        (f) =>
                          f.type ===
                          "mindmap"
                      ).length === 0)
                  }
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-550 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition shadow-lg cursor-pointer"
                >
                  Insert Embed
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Floating Link Paste Option Picker */}
      {/* Portaled to document.body: .editor-root-container gets a real
          backdrop-filter in Frosted Glass mode, which makes it the containing
          block for this popup's position:fixed — combined with the
          container's own overflow-hidden, that clipped the popup whenever it
          landed near the bottom of the page. Rendering outside the container
          (like the Insert Embed modal above) keeps it truly viewport-fixed. */}
      {pasteInfo && createPortal(
        <div
          id="link-paste-popup"
          style={{
            position: "fixed",
            top: `${pasteInfo.y}px`,
            left: `${pasteInfo.x}px`,
            zIndex: 9999
          }}
          className="bg-[#1e2330] border border-slate-700/80 rounded-xl shadow-2xl p-1 px-1.5 text-xs text-slate-200 select-none animate-in fade-in zoom-in-95 duration-100 flex flex-col space-y-0.5"
        >
          <div className="px-2 py-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-800 mb-1 truncate max-w-[200px]">
            {pasteInfo.url}
          </div>
          <button
            onClick={() =>
              setPasteInfo(null)
            }
            onMouseEnter={() =>
              setPasteSelectedIndex(0)
            }
            className={`flex items-center space-x-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-350 hover:text-slate-100 text-left cursor-pointer transition-colors w-full group ${
              pasteSelectedIndex === 0
                ? "bg-slate-800 text-slate-100"
                : ""
            }`}
          >
            <Link2
              size={13}
              className="text-violet-400 shrink-0"
            />
            <div className="flex flex-col">
              <span className="font-semibold text-[11px] leading-tight">
                Inline Link
              </span>
              <span className="text-[9px] text-slate-550">
                Keep standard hyperlink
              </span>
            </div>
          </button>
          <button
            onClick={() =>
              handleToastConvert(
                "bookmark"
              )
            }
            onMouseEnter={() =>
              setPasteSelectedIndex(1)
            }
            className={`flex items-center space-x-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-350 hover:text-slate-100 text-left cursor-pointer transition-colors w-full group ${
              pasteSelectedIndex === 1
                ? "bg-slate-800 text-slate-100"
                : ""
            }`}
          >
            <BookMarked
              size={13}
              className="text-emerald-400 shrink-0"
            />
            <div className="flex flex-col">
              <span className="font-semibold text-[11px] leading-tight">
                Bookmark Card
              </span>
              <span className="text-[9px] text-slate-550">
                Create rich preview card
              </span>
            </div>
          </button>
          <button
            onClick={() =>
              handleToastConvert(
                "embed"
              )
            }
            onMouseEnter={() =>
              setPasteSelectedIndex(2)
            }
            className={`flex items-center space-x-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-350 hover:text-slate-100 text-left cursor-pointer transition-colors w-full group ${
              pasteSelectedIndex === 2
                ? "bg-slate-800 text-slate-100"
                : ""
            }`}
          >
            <MonitorPlay
              size={13}
              className="text-amber-400 shrink-0"
            />
            <div className="flex flex-col">
              <span className="font-semibold text-[11px] leading-tight">
                Embed
              </span>
              <span className="text-[9px] text-slate-550">
                Insert interactive
                iframe
              </span>
            </div>
          </button>
        </div>,
        document.body
      )}

      {/* Version History Diff Modal Overlay */}
      {previewVersion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-6 select-none transition-opacity">
          <div className="bg-[#161b22] border border-slate-700/80 rounded-2xl shadow-2xl max-w-5xl w-full max-h-[85vh] flex flex-col overflow-hidden text-slate-200">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="p-1.5 bg-violet-600/10 text-violet-400 rounded-lg">
                  <RotateCcw
                    size={16}
                  />
                </span>
                <div>
                  <h3 className="text-sm font-bold tracking-wide">
                    Compare Snapshot
                    Version
                    (Side-by-Side)
                  </h3>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                    {
                      previewVersion.date
                    }
                  </p>
                </div>
              </div>
              <button
                onClick={() =>
                  setPreviewVersion(
                    null
                  )
                }
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-850 transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Split Headers */}
            <div className="grid grid-cols-2 divide-x divide-slate-800 border-b border-slate-800 bg-[#0d1117] text-[10px] uppercase font-bold tracking-widest text-slate-450 select-none shrink-0">
              <div className="px-6 py-2.5 flex items-center justify-between">
                <span>
                  Current Vault Version
                </span>
                <span className="text-[9px] bg-red-500/10 text-red-400/90 border border-red-500/15 px-1.5 py-0.5 rounded uppercase">
                  Current State
                </span>
              </div>
              <div className="px-6 py-2.5 flex items-center justify-between">
                <span>
                  Rollback Snapshot
                  Target
                </span>
                <span className="text-[9px] bg-emerald-500/10 text-emerald-400/90 border border-emerald-500/15 px-1.5 py-0.5 rounded uppercase">
                  Target State
                </span>
              </div>
            </div>

            {/* Diff content container */}
            <div className="flex-1 overflow-y-auto no-scrollbar font-mono text-[11px] bg-[#0d1117] select-text">
              <div className="flex flex-col divide-y divide-slate-900 bg-slate-950/20">
                {getSideBySideDiff(
                  initialContent || "",
                  previewVersion.content
                ).map((row, idx) => {
                  // Style left side
                  let leftBg =
                    "bg-transparent text-slate-350";
                  if (
                    row.left.type ===
                    "removed"
                  ) {
                    leftBg =
                      "bg-red-500/10 text-red-300 border-l-2 border-red-500/80";
                  } else if (
                    row.left.type ===
                    "empty"
                  ) {
                    leftBg =
                      "bg-slate-900/10 opacity-20";
                  }

                  // Style right side
                  let rightBg =
                    "bg-transparent text-slate-350";
                  if (
                    row.right.type ===
                    "added"
                  ) {
                    rightBg =
                      "bg-emerald-500/10 text-emerald-300 border-l-2 border-emerald-500/80";
                  } else if (
                    row.right.type ===
                    "empty"
                  ) {
                    rightBg =
                      "bg-slate-900/10 opacity-20";
                  }

                  return (
                    <div
                      key={idx}
                      className="grid grid-cols-2 divide-x divide-slate-900 min-w-0 transition-colors hover:bg-slate-900/10"
                    >
                      {/* Left Cell (Current) */}
                      <div
                        className={`py-1 flex gap-3 min-w-0 px-3 ${leftBg}`}
                      >
                        <span className="w-8 shrink-0 text-right text-[10px] text-slate-600 select-none border-r border-slate-900/40 pr-2">
                          {row.left
                            .lineNum ||
                            "~"}
                        </span>
                        <span className="flex-1 whitespace-pre-wrap break-all min-h-[1.25rem]">
                          {
                            row.left
                              .text
                          }
                        </span>
                      </div>
                      {/* Right Cell (Snapshot) */}
                      <div
                        className={`py-1 flex gap-3 min-w-0 px-3 ${rightBg}`}
                      >
                        <span className="w-8 shrink-0 text-right text-[10px] text-slate-600 select-none border-r border-slate-900/40 pr-2">
                          {row.right
                            .lineNum ||
                            "~"}
                        </span>
                        <span className="flex-1 whitespace-pre-wrap break-all min-h-[1.25rem]">
                          {
                            row.right
                              .text
                          }
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Actions bar */}
            <div className="px-6 py-4 bg-slate-900/40 border-t border-slate-800 flex justify-between items-center shrink-0">
              <span className="text-[10px] text-slate-500 flex gap-4 select-none">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 bg-red-500/20 border border-red-500/50 rounded-sm"></span>{" "}
                  Removed Lines
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 bg-emerald-500/20 border border-emerald-500/50 rounded-sm"></span>{" "}
                  Added Lines
                </span>
              </span>
              <div className="flex gap-3 select-none">
                <button
                  onClick={() =>
                    setPreviewVersion(
                      null
                    )
                  }
                  className="px-4 py-2 border border-slate-800 hover:bg-slate-800 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() =>
                    handleRollback(
                      previewVersion.timestamp,
                      true
                    )
                  }
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-550 text-white rounded-xl text-xs font-bold transition shadow-lg hover:shadow-violet-600/10 cursor-pointer"
                >
                  Confirm Rollback
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Table row/column gutters — Notion/ClickUp-style: a thin reserved
          margin along the table's left (row grips) and top (column grips)
          edges, plus "+" strips along the bottom/right for appending. They
          only render while the pointer is actually in one of those
          margins — never from hovering, selecting, or typing inside the
          table body — and clicking a grip opens a small menu with
          insert/delete actions for that specific row or column, so
          inserting/deleting in the middle of the table works the same as
          at the edges.

          Portaled to document.body: .editor-root-container gets a real
          backdrop-filter in Frosted Glass mode, which makes it the
          containing block for these buttons' position:fixed — resolving
          their coordinates against that container's box instead of the
          viewport, even though they were measured with
          getBoundingClientRect() (which is always viewport-relative).
          That mismatch is exactly what shifted the gutters off the table
          in production. Rendering outside the container (same fix as the
          Link Paste popup below) keeps them truly viewport-fixed. */}
      {tableGutter && createPortal(
        <>
          {tableGutter.rows.map((r, i) => (
            <button
              key={`row-${i}`}
              title={`Row ${i + 1} options`}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setTableGutterMenu({
                  type: "row",
                  index: i,
                  tableEl: tableGutter.tableEl,
                  top: r.top,
                  left: tableGutter.tableRect.left - TABLE_GUTTER_SIZE
                });
              }}
              style={{
                position: "fixed",
                top: `${r.top}px`,
                left: `${tableGutter.tableRect.left - TABLE_GUTTER_SIZE}px`,
                width: `${TABLE_GUTTER_SIZE}px`,
                height: `${r.height}px`,
                zIndex: 9998
              }}
              className={`flex items-center justify-center rounded-sm transition cursor-pointer ${
                tableGutter.hoverRow === i
                  ? "bg-violet-600/80 text-white"
                  : "bg-slate-700/30 text-slate-400 hover:bg-slate-600/50"
              }`}
            >
              <GripVertical size={11} />
            </button>
          ))}
          {tableGutter.cols.map((c, i) => (
            <button
              key={`col-${i}`}
              title={`Column ${i + 1} options`}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setTableGutterMenu({
                  type: "col",
                  index: i,
                  tableEl: tableGutter.tableEl,
                  top: tableGutter.tableRect.top - TABLE_GUTTER_SIZE,
                  left: c.left
                });
              }}
              style={{
                position: "fixed",
                top: `${tableGutter.tableRect.top - TABLE_GUTTER_SIZE}px`,
                left: `${c.left}px`,
                width: `${c.width}px`,
                height: `${TABLE_GUTTER_SIZE}px`,
                zIndex: 9998
              }}
              className={`flex items-center justify-center rounded-sm transition cursor-pointer ${
                tableGutter.hoverCol === i
                  ? "bg-violet-600/80 text-white"
                  : "bg-slate-700/30 text-slate-400 hover:bg-slate-600/50"
              }`}
            >
              <GripHorizontal size={11} />
            </button>
          ))}
          {/* Append row */}
          <button
            title="Add row"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              runTableIndexCommand(
                tableGutter.tableEl,
                "row",
                tableGutter.rows.length - 1,
                (chain) => chain.addRowAfter()
              );
            }}
            style={{
              position: "fixed",
              top: `${tableGutter.tableRect.top + tableGutter.tableRect.height}px`,
              left: `${tableGutter.tableRect.left}px`,
              width: `${tableGutter.tableRect.width}px`,
              height: `${TABLE_GUTTER_SIZE}px`,
              zIndex: 9998
            }}
            className={`flex items-center justify-center transition cursor-pointer ${
              tableGutter.hoverAddRow
                ? "bg-violet-600/80 text-white"
                : "bg-slate-700/20 text-slate-500 hover:bg-slate-600/40"
            }`}
          >
            <Plus size={12} />
          </button>
          {/* Append column */}
          <button
            title="Add column"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              runTableIndexCommand(
                tableGutter.tableEl,
                "col",
                tableGutter.cols.length - 1,
                (chain) => chain.addColumnAfter()
              );
            }}
            style={{
              position: "fixed",
              top: `${tableGutter.tableRect.top}px`,
              left: `${tableGutter.tableRect.left + tableGutter.tableRect.width}px`,
              width: `${TABLE_GUTTER_SIZE}px`,
              height: `${tableGutter.tableRect.height}px`,
              zIndex: 9998
            }}
            className={`flex items-center justify-center transition cursor-pointer ${
              tableGutter.hoverAddCol
                ? "bg-violet-600/80 text-white"
                : "bg-slate-700/20 text-slate-500 hover:bg-slate-600/40"
            }`}
          >
            <Plus size={12} />
          </button>
        </>,
        document.body
      )}
      {/* Row/column gutter menu — opened by clicking a grip above.
          Portaled for the same reason as the gutters themselves above. */}
      {tableGutterMenu && createPortal(
        <>
          <div
            className="fixed inset-0 z-[9998]"
            onMouseDown={() => setTableGutterMenu(null)}
          />
          <div
            className="fixed z-[9999] bg-[#161b22] border border-slate-700 rounded-lg shadow-2xl py-1 w-40 text-sm"
            style={{
              top: `${tableGutterMenu.top}px`,
              left: `${tableGutterMenu.left}px`
            }}
          >
            {tableGutterMenu.type === "row" ? (
              <>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    runTableIndexCommand(
                      tableGutterMenu.tableEl,
                      "row",
                      tableGutterMenu.index,
                      (chain) => chain.addRowBefore()
                    );
                    setTableGutterMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-700/60 flex items-center gap-2 text-slate-200"
                >
                  <ArrowUp size={13} /> Insert above
                </button>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    runTableIndexCommand(
                      tableGutterMenu.tableEl,
                      "row",
                      tableGutterMenu.index,
                      (chain) => chain.addRowAfter()
                    );
                    setTableGutterMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-700/60 flex items-center gap-2 text-slate-200"
                >
                  <ArrowDown size={13} /> Insert below
                </button>
                <div className="h-px bg-slate-700 my-1" />
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    runTableIndexCommand(
                      tableGutterMenu.tableEl,
                      "row",
                      tableGutterMenu.index,
                      (chain) => chain.deleteRow()
                    );
                    setTableGutterMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-red-900/30 flex items-center gap-2 text-red-400"
                >
                  <Trash2 size={13} /> Delete row
                </button>
              </>
            ) : (
              <>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    runTableIndexCommand(
                      tableGutterMenu.tableEl,
                      "col",
                      tableGutterMenu.index,
                      (chain) => chain.addColumnBefore()
                    );
                    setTableGutterMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-700/60 flex items-center gap-2 text-slate-200"
                >
                  <ArrowLeft size={13} /> Insert left
                </button>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    runTableIndexCommand(
                      tableGutterMenu.tableEl,
                      "col",
                      tableGutterMenu.index,
                      (chain) => chain.addColumnAfter()
                    );
                    setTableGutterMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-700/60 flex items-center gap-2 text-slate-200"
                >
                  <ArrowRight size={13} /> Insert right
                </button>
                <div className="h-px bg-slate-700 my-1" />
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    runTableIndexCommand(
                      tableGutterMenu.tableEl,
                      "col",
                      tableGutterMenu.index,
                      (chain) => chain.deleteColumn()
                    );
                    setTableGutterMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-red-900/30 flex items-center gap-2 text-red-400"
                >
                  <Trash2 size={13} /> Delete column
                </button>
              </>
            )}
          </div>
        </>,
        document.body
      )}
      {/* Floating cell background color picker — kept selection-driven
          (activeTableRect), not hover-driven: color needs to apply to
          whatever is actually selected (including a multi-cell
          drag-selection), which a hover point alone can't tell us.

          Portaled for the same containing-block reason as the gutters
          above — this is also position:fixed inside .editor-root-container. */}
      {activeTableRect && createPortal(
        <>
          {/* Cell background color picker */}
          <div
            style={{
              position: "fixed",
              top: `${activeTableRect.top - 38}px`,
              left: `${activeTableRect.cellLeft + activeTableRect.cellWidth / 2 + 20}px`,
              zIndex: 9999
            }}
          >
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setTableCellColorOpen(
                  (o) => !o
                );
              }}
              title="Cell background color"
              className="bg-[#1e2330] hover:bg-violet-600 border border-slate-700 hover:border-violet-500 text-slate-400 hover:text-white rounded-lg px-1.5 h-6 shadow-2xl transition cursor-pointer flex items-center gap-1 text-[9px] font-bold"
            >
              <Palette size={10} />{" "}
              Color
            </button>
            {tableCellColorOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onMouseDown={() =>
                    setTableCellColorOpen(
                      false
                    )
                  }
                />
                <div className="absolute top-7 left-0 z-20 bg-[#161b22] border border-slate-700 rounded-xl shadow-2xl p-2 flex flex-wrap gap-1.5 w-48">
                  {CELL_COLORS.map(
                    (c) => (
                      <button
                        key={c.value}
                        onMouseDown={(
                          e
                        ) => {
                          e.preventDefault();
                          e.stopPropagation();
                          editor
                            .chain()
                            .focus()
                            .updateAttributes(
                              "tableCell",
                              {
                                backgroundColor:
                                  c.value ||
                                  null
                              }
                            )
                            .run();
                          editor
                            .chain()
                            .focus()
                            .updateAttributes(
                              "tableHeader",
                              {
                                backgroundColor:
                                  c.value ||
                                  null
                              }
                            )
                            .run();
                          setTableCellColorOpen(
                            false
                          );
                        }}
                        title={c.label}
                        className="w-6 h-6 rounded border border-slate-700 hover:border-violet-400 transition cursor-pointer"
                        style={{
                          background:
                            c.value ||
                            "rgba(255,255,255,0.03)"
                        }}
                      />
                    )
                  )}
                </div>
              </>
            )}
          </div>
        </>,
        document.body
      )}
      {/* Attachment image hover preview bubble */}
      {imgPreviewUrl &&
        imgPreviewPos && (
          <div
            className="fixed z-[9999] pointer-events-none rounded-lg overflow-hidden shadow-2xl border border-slate-700/80 bg-slate-900"
            style={{
              top: imgPreviewPos.top,
              left: imgPreviewPos.left,
              transform:
                "translateY(-25%)"
            }}
          >
            <img
              src={imgPreviewUrl}
              alt=""
              className="block w-36 h-auto max-h-40 object-contain"
            />
          </div>
        )}
    </div>
  );
};
export default Editor;
