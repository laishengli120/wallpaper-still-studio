"use client";

import JSZip from "jszip";
import {
  ChangeEvent,
  DragEvent,
  InputHTMLAttributes,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type VirtualAsset = { path: string; blob: Blob };
type ProjectInfo = {
  title: string;
  entry: string;
  assetCount: number;
  projectType: string;
  warnings: string[];
  properties: Record<string, { value: unknown }>;
};
type EditableLayer = { selector: string; label: string };
type PreviewDrag = {
  selector: string;
  label: string;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
};
type ElementEdit = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  flipX: boolean;
  hidden: boolean;
};

const DEFAULT_ELEMENT_EDIT: ElementEdit = {
  x: 0,
  y: 0,
  scale: 100,
  rotation: 0,
  opacity: 100,
  zIndex: 0,
  flipX: false,
  hidden: false,
};

const PRESETS = {
  macbook: { label: "MacBook 6K", detail: "16:10", width: 6016, height: 3760 },
  display: { label: "显示器 6K", detail: "16:9", width: 6016, height: 3384 },
  uhd: { label: "通用 4K", detail: "16:9", width: 3840, height: 2160 },
} as const;

const PUBLIC_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  gif: "image/gif", svg: "image/svg+xml", avif: "image/avif", ico: "image/x-icon",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  json: "application/json", js: "text/javascript", mjs: "text/javascript", css: "text/css",
};

const normalizePath = (value: string) => {
  const parts: string[] = [];
  decodeURIComponent(value.replace(/\\/g, "/").split(/[?#]/)[0])
    .split("/")
    .forEach((part) => {
      if (!part || part === ".") return;
      if (part === "..") parts.pop();
      else parts.push(part);
    });
  return parts.join("/");
};

const dirname = (path: string) => path.split("/").slice(0, -1).join("/");

const resolvePath = (basePath: string, reference: string) => {
  if (/^(?:data:|blob:|https?:|javascript:|mailto:|tel:|#)/i.test(reference.trim())) return null;
  const clean = reference.trim().replace(/^['"]|['"]$/g, "");
  return normalizePath(clean.startsWith("/") ? clean : `${dirname(basePath)}/${clean}`);
};

const blobToDataUrl = (blob: Blob, path: string) =>
  new Promise<string>((resolve, reject) => {
    const extension = path.split(".").pop()?.toLowerCase() || "";
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([blob], { type: blob.type || MIME_BY_EXTENSION[extension] || "application/octet-stream" }));
  });

const escapeInlineScript = (text: string) => text.replace(/<\/script/gi, "<\\/script");

export default function WallpaperStillStudio() {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const assetsRef = useRef<Map<string, Blob>>(new Map());
  const dataUrlCacheRef = useRef<Map<string, string>>(new Map());
  const projectRef = useRef<ProjectInfo | null>(null);
  const tokenRef = useRef(crypto.randomUUID());
  const previewDragRef = useRef<PreviewDrag | null>(null);

  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [status, setStatus] = useState("等待导入项目");
  const [isBusy, setIsBusy] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [preset, setPreset] = useState<keyof typeof PRESETS>("macbook");
  const [zoom, setZoom] = useState(100);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [overrideBackground, setOverrideBackground] = useState(false);
  const [background, setBackground] = useState("#3f80b6");
  const [hideControls, setHideControls] = useState(true);
  const [runScripts, setRunScripts] = useState(true);
  const [freezeAnimations, setFreezeAnimations] = useState(true);
  const [captureDelay, setCaptureDelay] = useState(1.5);
  const [previewScale, setPreviewScale] = useState(1);
  const [editableLayers, setEditableLayers] = useState<EditableLayer[]>([]);
  const [selectedElement, setSelectedElement] = useState("");
  const [elementEdits, setElementEdits] = useState<Record<string, ElementEdit>>({});
  const [pickMode, setPickMode] = useState(false);
  const [dragMode, setDragMode] = useState(true);
  const [lycorisDetected, setLycorisDetected] = useState(false);
  const [lycorisLayout, setLycorisLayout] = useState(false);
  const [poleWidth, setPoleWidth] = useState(10);
  const [poleCurve, setPoleCurve] = useState(0);

  const output = PRESETS[preset];
  const previewWidth = 1600;
  const previewHeight = Math.round((previewWidth * output.height) / output.width);

  const config = useMemo(() => ({
    zoom,
    offsetX,
    offsetY,
    overrideBackground,
    background,
    hideControls,
    dragMode,
    lycorisLayout,
    poleWidth,
    poleCurve,
  }), [background, dragMode, hideControls, lycorisLayout, offsetX, offsetY, overrideBackground, poleCurve, poleWidth, zoom]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !project) return;
    const update = () => {
      if (viewport.clientWidth > 0) setPreviewScale(Math.min(1, viewport.clientWidth / previewWidth));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [project, previewHeight]);

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({
      type: "we-config",
      token: tokenRef.current,
      config,
    }, "*");
  }, [config, previewHeight]);

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({
      type: "we-element-styles",
      token: tokenRef.current,
      edits: Object.entries(elementEdits).map(([selector, edit]) => ({ selector, edit })),
    }, "*");
  }, [elementEdits]);

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({
      type: "we-pick-mode",
      token: tokenRef.current,
      enabled: pickMode,
    }, "*");
  }, [pickMode]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.token !== tokenRef.current) return;
      if (data.type === "we-ready") {
        setStatus("预览已就绪");
        iframeRef.current?.contentWindow?.postMessage({ type: "we-config", token: tokenRef.current, config }, "*");
        iframeRef.current?.contentWindow?.postMessage({
          type: "we-element-styles",
          token: tokenRef.current,
          edits: Object.entries(elementEdits).map(([selector, edit]) => ({ selector, edit })),
        }, "*");
        iframeRef.current?.contentWindow?.postMessage({ type: "we-list-elements", token: tokenRef.current }, "*");
      }
      if (data.type === "we-elements") {
        const layers = Array.isArray(data.elements) ? data.elements as EditableLayer[] : [];
        setEditableLayers(layers);
        const labels = layers.map((item) => item.label.toLowerCase()).join(" ");
        if (labels.includes("takina") && labels.includes("chisato")) setLycorisDetected(true);
      }
      if (data.type === "we-element-selected" && data.selector) {
        const selector = String(data.selector);
        const label = String(data.label || "网页元素");
        setEditableLayers((current) => current.some((item) => item.selector === selector)
          ? current
          : [...current, { selector, label }]);
        setSelectedElement(selector);
        setElementEdits((current) => ({
          ...current,
          [selector]: current[selector] || { ...DEFAULT_ELEMENT_EDIT },
        }));
        setPickMode(false);
        setStatus(`已选中：${label}`);
      }
      if (data.type === "we-element-drag" && data.selector) {
        const selector = String(data.selector);
        const label = String(data.label || "网页元素");
        const x = Number(data.x || 0);
        const y = Number(data.y || 0);
        setEditableLayers((current) => current.some((item) => item.selector === selector)
          ? current
          : [...current, { selector, label }]);
        setSelectedElement(selector);
        setElementEdits((current) => ({
          ...current,
          [selector]: { ...(current[selector] || DEFAULT_ELEMENT_EDIT), x, y },
        }));
        setPickMode(false);
        setStatus(`已拖动：${label}`);
      }
      if (data.type === "we-capture") {
        const blob = data.blob as Blob;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${(projectRef.current?.title || "wallpaper").replace(/[\\/:*?"<>|]/g, "-")}-${output.width}x${output.height}.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        setIsExporting(false);
        setStatus("静态壁纸已导出");
      }
      if (data.type === "we-capture-error") {
        setIsExporting(false);
        setStatus(`捕获失败：${data.message || "该壁纸包含无法读取的画面"}`);
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [config, elementEdits, output.height, output.width]);

  const findAsset = useCallback((reference: string, basePath: string) => {
    const resolved = resolvePath(basePath, reference);
    if (!resolved) return null;
    if (assetsRef.current.has(resolved)) return resolved;
    const suffix = `/${normalizePath(reference)}`;
    return [...assetsRef.current.keys()].find((key) => `/${key}`.endsWith(suffix)) || null;
  }, []);

  const getDataUrl = useCallback(async (path: string) => {
    const cached = dataUrlCacheRef.current.get(path);
    if (cached) return cached;
    const blob = assetsRef.current.get(path);
    if (!blob) return null;
    const url = await blobToDataUrl(blob, path);
    dataUrlCacheRef.current.set(path, url);
    return url;
  }, []);

  const rewriteCss = useCallback(async (css: string, cssPath: string) => {
    const matches = [...css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)].reverse();
    let result = css;
    for (const match of matches) {
      const path = findAsset(match[2], cssPath);
      if (!path || match.index === undefined) continue;
      const dataUrl = await getDataUrl(path);
      if (!dataUrl) continue;
      result = `${result.slice(0, match.index)}url("${dataUrl}")${result.slice(match.index + match[0].length)}`;
    }
    return result;
  }, [findAsset, getDataUrl]);

  const buildPreview = useCallback(async (allowProjectScripts: boolean) => {
    const info = projectRef.current;
    const entryBlob = info && assetsRef.current.get(info.entry);
    if (!info || !entryBlob) return;
    setIsBusy(true);
    setStatus("正在解析网页与本地素材…");

    try {
      const html = await entryBlob.text();
      const documentModel = new DOMParser().parseFromString(html, "text/html");
      documentModel.querySelectorAll("base").forEach((element) => element.remove());

      const scripts = [...documentModel.querySelectorAll<HTMLScriptElement>("script")];
      for (const script of scripts) {
        if (!allowProjectScripts) {
          script.remove();
          continue;
        }
        const source = script.getAttribute("src");
        if (!source) continue;
        const path = findAsset(source, info.entry);
        if (!path) continue;
        const blob = assetsRef.current.get(path);
        if (!blob) continue;
        script.removeAttribute("src");
        script.textContent = `${escapeInlineScript(await blob.text())}\n//# sourceURL=wallpaper://${path}`;
      }

      for (const link of [...documentModel.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]')]) {
        const path = findAsset(link.getAttribute("href") || "", info.entry);
        if (!path) continue;
        const blob = assetsRef.current.get(path);
        if (!blob) continue;
        const style = documentModel.createElement("style");
        style.textContent = await rewriteCss(await blob.text(), path);
        link.replaceWith(style);
      }

      for (const style of [...documentModel.querySelectorAll<HTMLStyleElement>("style")]) {
        style.textContent = await rewriteCss(style.textContent || "", info.entry);
      }

      for (const element of [...documentModel.querySelectorAll<HTMLElement>("[style]")]) {
        const value = element.getAttribute("style");
        if (value) element.setAttribute("style", await rewriteCss(value, info.entry));
      }

      const assetAttributes: Array<[string, string]> = [
        ["[src]", "src"], ["[poster]", "poster"], ["object[data]", "data"], ["link[href]", "href"],
      ];
      for (const [selector, attribute] of assetAttributes) {
        for (const element of [...documentModel.querySelectorAll<HTMLElement>(selector)]) {
          const value = element.getAttribute(attribute);
          if (!value) continue;
          const path = findAsset(value, info.entry);
          if (!path) continue;
          const dataUrl = await getDataUrl(path);
          if (dataUrl) element.setAttribute(attribute, dataUrl);
        }
      }

      const initialConfig = JSON.stringify(config).replace(/</g, "\\u003c");
      const assetLookup: Record<string, string> = {};
      for (const path of assetsRef.current.keys()) {
        if (/\.(?:png|jpe?g|gif|webp|svg|avif|mp3|wav|ogg|m4a|mp4|webm|json)$/i.test(path)) {
          const url = await getDataUrl(path);
          if (url) assetLookup[path] = url;
        }
      }
      const serializedAssets = JSON.stringify(assetLookup).replace(/</g, "\\u003c");
      const serializedProperties = JSON.stringify(info.properties).replace(/</g, "\\u003c");
      const token = JSON.stringify(tokenRef.current);

      const controlStyle = documentModel.createElement("style");
      controlStyle.id = "we-studio-style";
      controlStyle.textContent = `
        html, body { width: 100vw !important; height: 100vh !important; overflow: hidden !important; }
        body { transform: translate(var(--we-x, 0%), var(--we-y, 0%)) scale(var(--we-zoom, 1)) !important; transform-origin: center center !important; }
        html.we-background, html.we-background body { background: var(--we-background) !important; }
        html.we-hide-controls .ctrl-box, html.we-hide-controls .controls, html.we-hide-controls .control-box,
        html.we-hide-controls [class*="wallpaper-control"], html.we-hide-controls footer { display: none !important; }
        html.we-freeze *, html.we-freeze *::before, html.we-freeze *::after {
          animation-play-state: paused !important; transition: none !important;
        }
        html.we-pick-mode *, html.we-pick-mode *::before, html.we-pick-mode *::after { cursor: crosshair !important; }
        html.we-drag-mode [data-character], html.we-drag-mode img, html.we-drag-mode canvas,
        html.we-drag-mode [class*="character"], html.we-drag-mode [class*="sprite"], html.we-drag-mode [class*="layer"] { cursor: grab !important; }
        html.we-dragging *, html.we-dragging *::before, html.we-dragging *::after { cursor: grabbing !important; user-select: none !important; }
        [data-we-studio-selected="true"] { outline: 3px solid #ffd34d !important; outline-offset: -2px !important; }
        html.we-capturing [data-we-studio-selected="true"] { outline: none !important; }
        html.we-lycoris-layout .sakana-box canvas, html.we-lycoris-layout .sakana-bed { opacity: 0 !important; }
        html.we-lycoris-layout .sakana-character { transform: none !important; z-index: 2 !important; }
        html.we-lycoris-layout .sakana-box::after {
          content: "";
          position: absolute;
          z-index: 1;
          top: 540px;
          left: 50%;
          width: var(--we-pole-curve, 0px);
          height: calc(100vh + 360px);
          border-left: var(--we-pole-width, 10px) solid #24366f;
          border-radius: 50% 0 0 50%;
          pointer-events: none;
          transform: translateX(-50%) scaleX(var(--we-pole-direction, 1));
          transform-origin: top center;
        }
      `;
      documentModel.head.append(controlStyle);

      const prelude = documentModel.createElement("script");
      prelude.textContent = `
        (() => {
          const TOKEN = ${token};
          const ASSETS = ${serializedAssets};
          const PROPERTIES = ${serializedProperties};
          let CONFIG = ${initialConfig};
          let PICK_MODE = false;
          let SELECTED = null;
          let DRAG = null;
          const ORIGINALS = new WeakMap();
          const ELEMENT_RULES = new Map();
          const ELEMENT_EDITS = new Map();
          const elementOverrideStyle = document.createElement('style');
          elementOverrideStyle.id = 'we-studio-element-overrides';
          document.head.append(elementOverrideStyle);
          let elementKey = 0;
          const clean = value => String(value || '').replace(/^[.\\/]+/, '').split(/[?#]/)[0];
          const resolveAsset = value => {
            const key = clean(value);
            if (ASSETS[key]) return ASSETS[key];
            const match = Object.keys(ASSETS).find(path => path.endsWith('/' + key));
            return match ? ASSETS[match] : value;
          };
          const nativeSetAttribute = Element.prototype.setAttribute;
          Element.prototype.setAttribute = function(name, value) {
            if (/^(src|poster)$/i.test(name)) value = resolveAsset(value);
            return nativeSetAttribute.call(this, name, value);
          };
          const nativeFetch = window.fetch;
          window.fetch = (input, init) => nativeFetch(resolveAsset(typeof input === 'string' ? input : input.url), init);
          window.wallpaperRegisterAudioListener = () => {};
          window.wallpaperRegisterMediaPropertiesListener = () => {};
          const nativePlay = HTMLMediaElement.prototype.play;
          HTMLMediaElement.prototype.play = function() { this.muted = true; return Promise.resolve(); };
          const escapeSelector = value => {
            if (window.CSS?.escape) return CSS.escape(value);
            return String(value).replace(/[^a-zA-Z0-9_-]/g, character => String.fromCharCode(92) + character);
          };
          const selectorFor = element => {
            if (element.id) return '#' + escapeSelector(element.id);
            const character = element.getAttribute('data-character');
            if (character) return '[data-character="' + escapeSelector(character) + '"]';
            const classNames = [...element.classList].filter(Boolean).slice(0, 4);
            if (classNames.length) {
              const classSelector = element.tagName.toLowerCase() + classNames.map(name => '.' + escapeSelector(name)).join('');
              try { if (document.querySelectorAll(classSelector).length === 1) return classSelector; } catch (_) {}
            }
            const parts = [];
            let node = element;
            while (node && node !== document.body && node.nodeType === 1) {
              let part = node.tagName.toLowerCase();
              const parent = node.parentElement;
              if (parent) {
                const siblings = [...parent.children].filter(item => item.tagName === node.tagName);
                if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
              }
              parts.unshift(part);
              node = parent;
            }
            return 'body > ' + parts.join(' > ');
          };
          const labelFor = element => {
            const rect = element.getBoundingClientRect();
            const id = element.id ? '#' + element.id : '';
            const classes = [...element.classList].filter(name => !name.startsWith('we-')).slice(0, 2).map(name => '.' + name).join('');
            const character = element.getAttribute('data-character');
            return element.tagName.toLowerCase() + id + classes + (character ? ' · ' + character : '') + ' · ' + Math.round(rect.width) + '×' + Math.round(rect.height);
          };
          const originalFor = element => {
            if (!ORIGINALS.has(element)) {
              const computed = getComputedStyle(element);
              ORIGINALS.set(element, {
                key: 'we-layer-' + (++elementKey),
                transform: computed.transform === 'none' ? '' : computed.transform,
                opacity: Number(computed.opacity || 1),
                zIndex: computed.zIndex,
              });
            }
            return ORIGINALS.get(element);
          };
          const applyElementEdit = (selector, edit) => {
            let element;
            try { element = document.querySelector(selector); } catch (_) { return; }
            if (!element) return;
            const nextEdit = { ...(ELEMENT_EDITS.get(selector) || {}), ...edit };
            ELEMENT_EDITS.set(selector, nextEdit);
            edit = nextEdit;
            const original = originalFor(element);
            element.setAttribute('data-we-studio-key', original.key);
            const scale = Math.max(0.01, Number(edit.scale ?? 100) / 100);
            const scaleX = edit.flipX ? -scale : scale;
            const transform = 'translate(' + Number(edit.x || 0) + 'vw, ' + Number(edit.y || 0) + 'vh) rotate(' + Number(edit.rotation || 0) + 'deg) scale(' + scaleX + ', ' + scale + ')' + (original.transform ? ' ' + original.transform : '');
            const declarations = [
              'transform:' + transform + '!important',
              'transform-origin:center center!important',
              'opacity:' + (original.opacity * Number(edit.opacity ?? 100) / 100) + '!important',
            ];
            if (edit.hidden) declarations.push('display:none!important');
            if (Number(edit.zIndex || 0) !== 0) declarations.push('z-index:' + Number(edit.zIndex) + '!important');
            else if (original.zIndex !== 'auto') declarations.push('z-index:' + original.zIndex + '!important');
            ELEMENT_RULES.set(selector, 'html body [data-we-studio-key="' + original.key + '"][data-we-studio-key="' + original.key + '"]{' + declarations.join(';') + '}');
            elementOverrideStyle.textContent = [...ELEMENT_RULES.values()].join('\\n');
          };
          const listElements = () => {
            const candidates = new Set(document.querySelectorAll('img, canvas, video, svg, picture, [style*="background"], [class*="character"], [class*="sprite"], [class*="layer"]'));
            [...candidates].forEach(element => {
              if (element.tagName === 'CANVAS' && element.parentElement && element.parentElement !== document.body) candidates.add(element.parentElement);
            });
            document.querySelectorAll('div').forEach(element => {
              if (getComputedStyle(element).backgroundImage !== 'none') candidates.add(element);
            });
            const elements = [...candidates]
              .filter(element => {
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                return element !== document.documentElement && element !== document.body && rect.width >= 24 && rect.height >= 24 && style.display !== 'none' && style.visibility !== 'hidden';
              })
              .slice(0, 100)
              .map(element => ({ selector: selectorFor(element), label: labelFor(element) }));
            parent.postMessage({ type: 'we-elements', token: TOKEN, elements }, '*');
          };
          const clearSelection = () => {
            if (SELECTED) SELECTED.removeAttribute('data-we-studio-selected');
            SELECTED = null;
          };
          const selectElement = element => {
            if (!element || element === document.body || element === document.documentElement) return;
            clearSelection();
            SELECTED = element;
            SELECTED.setAttribute('data-we-studio-selected', 'true');
            parent.postMessage({ type: 'we-element-selected', token: TOKEN, selector: selectorFor(element), label: labelFor(element) }, '*');
          };
          const dragTargetFor = element => {
            if (!(element instanceof Element)) return null;
            const character = element.closest('[data-character], .sakana-character');
            if (character) return character.closest('.sakana-box') || character;
            const candidate = element.closest('img, canvas, video, svg, picture, [class*="character"], [class*="sprite"], [class*="layer"], [style*="background"]');
            return candidate && candidate !== document.documentElement && candidate !== document.body ? candidate : null;
          };
          document.addEventListener('mousedown', event => {
            if (event.button !== 0) return;
            const target = dragTargetFor(event.target);
            if (PICK_MODE) {
              if (!target) return;
              event.preventDefault();
              event.stopImmediatePropagation();
              selectElement(target);
              return;
            }
            if (!CONFIG.dragMode || !target) return;
            const selector = selectorFor(target);
            const current = ELEMENT_EDITS.get(selector) || {};
            DRAG = {
              target,
              selector,
              label: labelFor(target),
              startClientX: event.clientX,
              startClientY: event.clientY,
              startX: Number(current.x || 0),
              startY: Number(current.y || 0),
            };
            event.preventDefault();
            event.stopImmediatePropagation();
            document.documentElement.classList.add('we-dragging');
            selectElement(target);
          }, true);
          document.addEventListener('mousemove', event => {
            if (!DRAG) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            const x = Math.round((DRAG.startX + (event.clientX - DRAG.startClientX) / window.innerWidth * 100) * 100) / 100;
            const y = Math.round((DRAG.startY + (event.clientY - DRAG.startClientY) / window.innerHeight * 100) * 100) / 100;
            const edit = { ...(ELEMENT_EDITS.get(DRAG.selector) || {}), x, y };
            applyElementEdit(DRAG.selector, edit);
            parent.postMessage({ type: 'we-element-drag', token: TOKEN, selector: DRAG.selector, label: DRAG.label, x, y }, '*');
          }, true);
          const finishDrag = () => {
            if (!DRAG) return;
            DRAG = null;
            document.documentElement.classList.remove('we-dragging');
          };
          document.addEventListener('mouseup', finishDrag, true);
          window.addEventListener('blur', finishDrag);
          const apply = next => {
            CONFIG = { ...CONFIG, ...next };
            const root = document.documentElement;
            root.style.setProperty('--we-zoom', String(CONFIG.zoom / 100));
            root.style.setProperty('--we-x', CONFIG.offsetX + '%');
            root.style.setProperty('--we-y', CONFIG.offsetY + '%');
            root.style.setProperty('--we-background', CONFIG.background);
            root.style.setProperty('--we-pole-width', Math.max(1, Number(CONFIG.poleWidth || 10)) + 'px');
            root.style.setProperty('--we-pole-curve', Math.abs(Number(CONFIG.poleCurve || 0)) + 'px');
            root.style.setProperty('--we-pole-direction', Number(CONFIG.poleCurve || 0) < 0 ? '-1' : '1');
            root.classList.toggle('we-background', !!CONFIG.overrideBackground);
            root.classList.toggle('we-hide-controls', !!CONFIG.hideControls);
            root.classList.toggle('we-drag-mode', !!CONFIG.dragMode);
            root.classList.toggle('we-lycoris-layout', !!CONFIG.lycorisLayout);
            document.querySelectorAll('audio, video').forEach(media => { media.muted = true; });
          };
          window.addEventListener('message', event => {
            const data = event.data || {};
            if (data.token !== TOKEN) return;
            if (data.type === 'we-config') apply(data.config || {});
            if (data.type === 'we-pick-mode') {
              PICK_MODE = !!data.enabled;
              document.documentElement.classList.toggle('we-pick-mode', PICK_MODE);
            }
            if (data.type === 'we-element-styles') {
              ELEMENT_RULES.clear();
              ELEMENT_EDITS.clear();
              elementOverrideStyle.textContent = '';
              (data.edits || []).forEach(item => applyElementEdit(item.selector, item.edit || {}));
            }
            if (data.type === 'we-select-element') {
              try { selectElement(document.querySelector(data.selector)); } catch (_) {}
            }
            if (data.type === 'we-clear-selection') clearSelection();
            if (data.type === 'we-list-elements') listElements();
          });
          window.addEventListener('DOMContentLoaded', () => apply(CONFIG));
          window.addEventListener('load', () => {
            apply(CONFIG);
            const sendProperties = () => {
              try { window.wallpaperPropertyListener?.applyUserProperties?.(PROPERTIES); } catch (_) {}
            };
            sendProperties();
            setTimeout(sendProperties, 400);
            parent.postMessage({ type: 'we-ready', token: TOKEN }, '*');
            setTimeout(listElements, 500);
          });
          window.__WE_STUDIO__ = {
            token: TOKEN,
            apply,
            getConfig: () => CONFIG,
            setCapturing: active => document.documentElement.classList.toggle('we-capturing', !!active),
            targetAt: (x, y) => {
              const target = dragTargetFor(document.elementFromPoint(x, y));
              if (!target) return null;
              const result = { selector: selectorFor(target), label: labelFor(target) };
              selectElement(target);
              return result;
            },
          };
        })();
      `;
      documentModel.head.prepend(prelude);

      const captureLibrary = documentModel.createElement("script");
      captureLibrary.src = new URL(`${PUBLIC_BASE_PATH}/html2canvas.min.js`, window.location.origin).href;
      documentModel.body.append(captureLibrary);

      const captureBridge = documentModel.createElement("script");
      captureBridge.textContent = `
        window.addEventListener('message', async event => {
          const data = event.data || {};
          const studio = window.__WE_STUDIO__;
          if (!studio || data.token !== studio.token || data.type !== 'we-capture') return;
          try {
            await new Promise(resolve => setTimeout(resolve, Math.max(0, data.delay || 0)));
            studio.setCapturing(true);
            if (data.freeze) document.documentElement.classList.add('we-freeze');
            if (document.fonts?.ready) await document.fonts.ready;
            const source = await window.html2canvas(document.documentElement, {
              width: window.innerWidth,
              height: window.innerHeight,
              scale: data.width / window.innerWidth,
              backgroundColor: studio.getConfig().overrideBackground ? studio.getConfig().background : null,
              useCORS: true,
              allowTaint: false,
              logging: false,
              windowWidth: window.innerWidth,
              windowHeight: window.innerHeight,
              onclone: clonedDocument => {
                // html2canvas can omit CSS-generated ::after content in its cloned document.
                // Materialize the Lycoris support pole as a real element for reliable PNG export.
                const root = clonedDocument.documentElement;
                if (!root.classList.contains('we-lycoris-layout')) return;
                const cloneWindow = clonedDocument.defaultView;
                if (!cloneWindow) return;
                const poleClones = [];
                clonedDocument.querySelectorAll('.sakana-box').forEach(box => {
                  const pseudo = cloneWindow.getComputedStyle(box, '::after');
                  const content = pseudo.getPropertyValue('content');
                  if (!content || content === 'none' || content === 'normal' ||
                      pseudo.display === 'none' || pseudo.visibility === 'hidden' ||
                      Number(pseudo.opacity) === 0) return;
                  const pole = clonedDocument.createElement('div');
                  pole.setAttribute('data-we-export-static-pole', '');
                  for (let i = 0; i < pseudo.length; i += 1) {
                    const property = pseudo.item(i);
                    const value = pseudo.getPropertyValue(property);
                    if (value) pole.style.setProperty(property, value, 'important');
                  }
                  pole.style.removeProperty('content');
                  pole.style.setProperty('pointer-events', 'none', 'important');
                  poleClones.push({ box, pole });
                });
                if (!poleClones.length) return;
                const poleStyle = clonedDocument.createElement('style');
                poleStyle.textContent = 'html.we-exporting-static-poles .sakana-box::after { content: none !important; display: none !important; }';
                clonedDocument.head.appendChild(poleStyle);
                root.classList.add('we-exporting-static-poles');
                poleClones.forEach(({ box, pole }) => box.appendChild(pole));
              },
            });
            const output = document.createElement('canvas');
            output.width = data.width;
            output.height = data.height;
            output.getContext('2d').drawImage(source, 0, 0, data.width, data.height);
            output.toBlob(blob => {
              parent.postMessage({ type: 'we-capture', token: studio.token, blob }, '*');
              document.documentElement.classList.remove('we-freeze');
              studio.setCapturing(false);
            }, 'image/png');
          } catch (error) {
            document.documentElement.classList.remove('we-freeze');
            studio.setCapturing(false);
            parent.postMessage({ type: 'we-capture-error', token: studio.token, message: error?.message }, '*');
          }
        });
      `;
      documentModel.body.append(captureBridge);

      const completePage = `<!doctype html>\n${documentModel.documentElement.outerHTML}`;
      setPreviewHtml(completePage);
      setStatus("正在启动隔离预览…");
    } catch (error) {
      setStatus(`解析失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setIsBusy(false);
    }
  }, [config, findAsset, getDataUrl, rewriteCss]);

  const importAssets = useCallback(async (inputAssets: VirtualAsset[], sourceName: string) => {
    setIsBusy(true);
    setStatus("正在读取项目…");
    try {
      let paths = inputAssets.map((asset) => ({ ...asset, path: normalizePath(asset.path) })).filter((asset) => asset.path);
      const firstSegments = new Set(paths.map((asset) => asset.path.split("/")[0]));
      if (firstSegments.size === 1 && paths.every((asset) => asset.path.includes("/"))) {
        paths = paths.map((asset) => ({ ...asset, path: asset.path.split("/").slice(1).join("/") }));
      }

      const projectAsset = paths
        .filter((asset) => asset.path.toLowerCase().endsWith("project.json"))
        .sort((a, b) => a.path.split("/").length - b.path.split("/").length)[0];
      let projectJson: Record<string, unknown> = {};
      let root = "";
      if (projectAsset) {
        projectJson = JSON.parse(await projectAsset.blob.text());
        root = dirname(projectAsset.path);
      }

      const rooted = paths
        .filter((asset) => !root || asset.path === root || asset.path.startsWith(`${root}/`))
        .map((asset) => ({ ...asset, path: root ? asset.path.slice(root.length + 1) : asset.path }));
      const fileMap = new Map(rooted.map((asset) => [normalizePath(asset.path), asset.blob]));
      const configuredEntry = typeof projectJson.file === "string" ? normalizePath(projectJson.file) : "";
      const fallbackEntry = [...fileMap.keys()]
        .filter((path) => /\.html?$/i.test(path))
        .sort((a, b) => a.split("/").length - b.split("/").length)[0];
      const entry = configuredEntry || fallbackEntry;
      if (!entry || !fileMap.has(entry)) throw new Error("没有找到 project.json 指定的网页入口或 HTML 文件");

      const rawProperties = (projectJson.general as { properties?: Record<string, { value?: unknown }> } | undefined)?.properties || {};
      const properties = Object.fromEntries(Object.entries(rawProperties).map(([key, value]) => [key, { value: value?.value }]));
      const projectType = String(projectJson.type || "web");
      const warnings: string[] = [];
      if (projectType !== "web") warnings.push("该项目不是网页壁纸，当前工具只能按网页方式尝试解析。");
      if ([...fileMap.keys()].some((path) => /\.(?:mp4|webm|mov)$/i.test(path))) warnings.push("检测到视频素材；导出时会截取当前画面，受保护视频可能为空白。");
      const entryText = await fileMap.get(entry)!.text();
      if (/webgl|three(?:\.min)?\.js|pixi(?:\.min)?\.js/i.test(entryText)) warnings.push("检测到 WebGL/图形引擎；浏览器截图可能无法完整读取 GPU 画面。");

      const info: ProjectInfo = {
        title: String(projectJson.title || sourceName.replace(/\.zip$/i, "") || "Wallpaper Engine 项目"),
        entry,
        assetCount: fileMap.size,
        projectType,
        warnings,
        properties,
      };
      const hasLycorisPair = /(?:lycoris|莉可丽丝|石蒜)/i.test(info.title)
        || (/data-character=["']takina["']/i.test(entryText) && /data-character=["']chisato["']/i.test(entryText));
      assetsRef.current = fileMap;
      dataUrlCacheRef.current = new Map();
      projectRef.current = info;
      setProject(info);
      setEditableLayers([]);
      setSelectedElement("");
      setElementEdits(hasLycorisPair ? {
        "div.takina.sakana-box": { ...DEFAULT_ELEMENT_EDIT, x: 2.5, y: 2 },
        "div.chisato.sakana-box": { ...DEFAULT_ELEMENT_EDIT, x: -2.5, y: 2 },
      } : {});
      setPickMode(false);
      setZoom(100);
      setOffsetX(0);
      setOffsetY(0);
      setLycorisDetected(hasLycorisPair);
      setLycorisLayout(hasLycorisPair);
      setPoleWidth(10);
      setPoleCurve(0);
      if (hasLycorisPair) {
        setPreset("display");
        setOverrideBackground(true);
        setBackground("#3f80b6");
        setHideControls(true);
      }
      await buildPreview(runScripts);
    } catch (error) {
      setStatus(`导入失败：${error instanceof Error ? error.message : "无法读取项目"}`);
    } finally {
      setIsBusy(false);
    }
  }, [buildPreview, runScripts]);

  const importFolder = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files || [])];
    if (!files.length) return;
    const assets = files.map((file) => ({ path: file.webkitRelativePath || file.name, blob: file }));
    await importAssets(assets, files[0].webkitRelativePath.split("/")[0] || "Wallpaper Engine 项目");
    event.target.value = "";
  };

  const importZipFile = async (file: File) => {
    setIsBusy(true);
    setStatus("正在解压项目…");
    try {
      const zip = await JSZip.loadAsync(file);
      const assets: VirtualAsset[] = [];
      for (const item of Object.values(zip.files)) {
        if (!item.dir) assets.push({ path: item.name, blob: await item.async("blob") });
      }
      await importAssets(assets, file.name);
    } catch (error) {
      setStatus(`ZIP 读取失败：${error instanceof Error ? error.message : "文件可能已损坏"}`);
      setIsBusy(false);
    }
  };

  const importZip = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) await importZipFile(file);
    event.target.value = "";
  };

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = [...event.dataTransfer.files].find((item) => item.name.toLowerCase().endsWith(".zip"));
    if (file) await importZipFile(file);
    else setStatus("拖放区域目前接收 ZIP；项目文件夹请使用“选择文件夹”。");
  };

  const changeScriptMode = async (enabled: boolean) => {
    setRunScripts(enabled);
    if (projectRef.current) await buildPreview(enabled);
  };

  const applyLycorisPreset = () => {
    setPreset("display");
    setZoom(100);
    setOffsetX(0);
    setOffsetY(0);
    setOverrideBackground(true);
    setBackground("#3f80b6");
    setHideControls(true);
    setLycorisLayout(true);
    setPoleWidth(10);
    setPoleCurve(0);
    setElementEdits({
      "div.takina.sakana-box": { ...DEFAULT_ELEMENT_EDIT, x: 2.5, y: 2 },
      "div.chisato.sakana-box": { ...DEFAULT_ELEMENT_EDIT, x: -2.5, y: 2 },
    });
    setSelectedElement("");
    iframeRef.current?.contentWindow?.postMessage({
      type: "we-clear-selection",
      token: tokenRef.current,
    }, "*");
    setStatus("已恢复莉可丽丝经典双人静态构图");
  };

  const selectLayer = (selector: string) => {
    setSelectedElement(selector);
    setElementEdits((current) => ({
      ...current,
      [selector]: current[selector] || { ...DEFAULT_ELEMENT_EDIT },
    }));
    iframeRef.current?.contentWindow?.postMessage({
      type: "we-select-element",
      token: tokenRef.current,
      selector,
    }, "*");
  };

  const updateSelectedElement = (patch: Partial<ElementEdit>) => {
    if (!selectedElement) return;
    setElementEdits((current) => ({
      ...current,
      [selectedElement]: { ...(current[selectedElement] || DEFAULT_ELEMENT_EDIT), ...patch },
    }));
  };

  const previewTargetAt = (event: ReactPointerEvent<HTMLDivElement>) => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const studio = (iframe.contentWindow as typeof iframe.contentWindow & {
      __WE_STUDIO__?: { targetAt?: (x: number, y: number) => EditableLayer | null };
    }).__WE_STUDIO__;
    return studio?.targetAt?.(
      (event.clientX - rect.left) / previewScale,
      (event.clientY - rect.top) / previewScale,
    ) || null;
  };

  const beginPreviewDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = previewTargetAt(event);
    if (!target) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setEditableLayers((current) => current.some((item) => item.selector === target.selector)
      ? current
      : [...current, target]);
    setSelectedElement(target.selector);
    setPickMode(false);
    setElementEdits((current) => ({
      ...current,
      [target.selector]: current[target.selector] || { ...DEFAULT_ELEMENT_EDIT },
    }));
    if (!dragMode) {
      setStatus(`已选中：${target.label}`);
      return;
    }
    const current = elementEdits[target.selector] || DEFAULT_ELEMENT_EDIT;
    previewDragRef.current = {
      selector: target.selector,
      label: target.label,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: current.x,
      startY: current.y,
    };
    setStatus(`正在拖动：${target.label}`);
  };

  const movePreviewDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = previewDragRef.current;
    if (!drag) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.round((drag.startX + (event.clientX - drag.startClientX) / rect.width * 100) * 100) / 100;
    const y = Math.round((drag.startY + (event.clientY - drag.startClientY) / rect.height * 100) * 100) / 100;
    setElementEdits((current) => ({
      ...current,
      [drag.selector]: { ...(current[drag.selector] || DEFAULT_ELEMENT_EDIT), x, y },
    }));
    setStatus(`已拖动：${drag.label}`);
  };

  const finishPreviewDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!previewDragRef.current) return;
    previewDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const resetSelectedElement = () => {
    if (!selectedElement) return;
    setElementEdits((current) => ({ ...current, [selectedElement]: { ...DEFAULT_ELEMENT_EDIT } }));
  };

  const exportWallpaper = () => {
    if (!project || !iframeRef.current?.contentWindow) return;
    setIsExporting(true);
    setStatus(`正在捕获 ${output.width} × ${output.height}…`);
    iframeRef.current.contentWindow.postMessage({
      type: "we-capture",
      token: tokenRef.current,
      width: output.width,
      height: output.height,
      delay: captureDelay * 1000,
      freeze: freezeAnimations,
    }, "*");
  };

  const directoryAttributes = { webkitdirectory: "", directory: "" } as InputHTMLAttributes<HTMLInputElement>;
  const selectedEdit = selectedElement ? (elementEdits[selectedElement] || DEFAULT_ELEMENT_EDIT) : null;
  const selectedLayer = editableLayers.find((item) => item.selector === selectedElement);

  return (
    <main className="app-shell">
      <input ref={folderInputRef} className="hidden-input" type="file" multiple {...directoryAttributes} onChange={importFolder} />
      <input ref={zipInputRef} className="hidden-input" type="file" accept=".zip,application/zip" onChange={importZip} />

      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">W</span>
          <div>
            <p className="eyebrow">WALLPAPER STILL</p>
            <h1>网页壁纸静态导出器</h1>
          </div>
        </div>
        <div className="status-pill"><span className={isBusy || isExporting ? "working" : ""} />{status}</div>
      </header>

      {!project ? (
        <section className="import-hero" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
          <div className="import-badge">LOCAL · PRIVATE · MUTED</div>
          <h2>把动态网页壁纸，定格成你的桌面。</h2>
          <p>读取 Wallpaper Engine 网页项目，预览后调整构图、背景和截帧时机，再导出高分辨率 PNG。所有文件只在本机浏览器中处理。</p>
          <div className="import-actions">
            <button className="primary-button" disabled={isBusy} onClick={() => folderInputRef.current?.click()}>选择项目文件夹</button>
            <button className="secondary-button" disabled={isBusy} onClick={() => zipInputRef.current?.click()}>选择 ZIP</button>
          </div>
          <div className="import-rule"><span>可识别</span><b>project.json</b><b>HTML / CSS / JS</b><b>本地图片与字体</b></div>
          <small>也可以把 ZIP 直接拖到这里</small>
        </section>
      ) : (
        <section className="workspace">
          <div className="preview-column">
            <div className="preview-toolbar">
              <div>
                <strong>{project.title}</strong>
                <span>{output.width} × {output.height}</span>
              </div>
              <div className="preview-actions">
                <button onClick={() => buildPreview(runScripts)}>重新载入预览</button>
                <button onClick={() => folderInputRef.current?.click()}>更换项目</button>
              </div>
            </div>
            <div
              ref={viewportRef}
              className="wallpaper-viewport"
              style={{ aspectRatio: `${previewWidth} / ${previewHeight}` }}
            >
              {previewHtml ? (
                <iframe
                  ref={iframeRef}
                  title={`${project.title} 隔离预览`}
                  sandbox="allow-scripts allow-same-origin allow-downloads"
                  srcDoc={previewHtml}
                  width={previewWidth}
                  height={previewHeight}
                  onLoad={() => iframeRef.current?.contentWindow?.postMessage({ type: "we-config", token: tokenRef.current, config }, "*")}
                  style={{ width: previewWidth, height: previewHeight, transform: `scale(${previewScale})` }}
                />
              ) : <div className="preview-loading">正在准备预览…</div>}
              {previewHtml && (dragMode || pickMode) && (
                <div
                  aria-label="壁纸预览拖动区域"
                  className="preview-interaction-layer"
                  onPointerDown={beginPreviewDrag}
                  onPointerMove={movePreviewDrag}
                  onPointerUp={finishPreviewDrag}
                  onPointerCancel={finishPreviewDrag}
                />
              )}
            </div>
            <div className="preview-footer">
              <span>入口：{project.entry}</span>
              <span>{project.assetCount} 个项目文件 · 音频已静音</span>
            </div>
            {project.warnings.length > 0 && (
              <div className="warning-box">
                {project.warnings.map((warning) => <p key={warning}>{warning}</p>)}
              </div>
            )}
          </div>

          <aside className="controls">
            <div className="control-section">
              <div className="section-title"><span>01</span><h2>输出尺寸</h2></div>
              <div className="preset-grid">
                {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((key) => (
                  <button key={key} className={preset === key ? "active" : ""} onClick={() => setPreset(key)}>
                    <b>{PRESETS[key].label}</b><small>{PRESETS[key].detail}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="control-section">
              <div className="section-title"><span>02</span><h2>画面构图</h2></div>
              <label className="range-row"><span><b>缩放</b><output>{zoom}%</output></span><input data-testid="scene-zoom" aria-label="画面缩放" type="range" min="50" max="160" value={zoom} onInput={(event) => setZoom(Number(event.currentTarget.value))} /></label>
              <label className="range-row"><span><b>水平位置</b><output>{offsetX}%</output></span><input data-testid="scene-x" aria-label="画面水平位置" type="range" min="-50" max="50" value={offsetX} onInput={(event) => setOffsetX(Number(event.currentTarget.value))} /></label>
              <label className="range-row"><span><b>垂直位置</b><output>{offsetY}%</output></span><input data-testid="scene-y" aria-label="画面垂直位置" type="range" min="-50" max="50" value={offsetY} onInput={(event) => setOffsetY(Number(event.currentTarget.value))} /></label>
              <label className="toggle-row"><span><b>替换背景色</b><small>覆盖网页原始背景</small></span><input type="checkbox" checked={overrideBackground} onChange={(event) => setOverrideBackground(event.target.checked)} /></label>
              {overrideBackground && <label className="color-row"><span>背景颜色</span><span className="color-input-wrap"><input type="color" value={background} onChange={(event) => setBackground(event.target.value)} /><code>{background}</code></span></label>}
              <label className="toggle-row"><span><b>隐藏网页控件</b><small>自动隐藏常见控制区和页脚</small></span><input type="checkbox" checked={hideControls} onChange={(event) => setHideControls(event.target.checked)} /></label>
            </div>

            <div className="control-section">
              <div className="section-title"><span>03</span><h2>元素精调</h2></div>
              <label className="toggle-row direct-drag-toggle">
                <span><b>鼠标直接拖动</b><small>在预览中按住人物或图片即可调整位置</small></span>
                <input aria-label="鼠标直接拖动" type="checkbox" checked={dragMode} onChange={(event) => setDragMode(event.target.checked)} />
              </label>
              {lycorisDetected && (
                <div className="adapter-card">
                  <div className="adapter-heading">
                    <span>已识别专用适配</span>
                    <b>莉可丽丝双人支撑构图</b>
                  </div>
                  <button className="adapter-preset" onClick={applyLycorisPreset}>恢复经典双人构图</button>
                  <label className="toggle-row adapter-toggle">
                    <span><b>固定人物与静态支撑杆</b><small>关闭原 Canvas 动态杆，避免导出时晃动</small></span>
                    <input aria-label="固定人物与静态支撑杆" type="checkbox" checked={lycorisLayout} onChange={(event) => setLycorisLayout(event.target.checked)} />
                  </label>
                  {lycorisLayout && (
                    <div className="adapter-ranges">
                      <label className="range-row"><span><b>支撑杆弯曲</b><output>{poleCurve}</output></span><input data-testid="pole-curve" aria-label="支撑杆弯曲" type="range" min="-120" max="120" value={poleCurve} onInput={(event) => setPoleCurve(Number(event.currentTarget.value))} /></label>
                      <label className="range-row"><span><b>支撑杆粗细</b><output>{poleWidth}px</output></span><input data-testid="pole-width" aria-label="支撑杆粗细" type="range" min="2" max="28" value={poleWidth} onInput={(event) => setPoleWidth(Number(event.currentTarget.value))} /></label>
                    </div>
                  )}
                  <p>直接拖动人物会连同支撑杆一起移动；也可从下方列表分别调整大小、位置和旋转。</p>
                </div>
              )}
              <div className="element-picker">
                <select
                  aria-label="选择自动识别的网页元素"
                  value={selectedElement}
                  onChange={(event) => event.target.value && selectLayer(event.target.value)}
                >
                  <option value="">选择图片、人物或 Canvas 图层</option>
                  {editableLayers.map((layer) => <option key={layer.selector} value={layer.selector}>{layer.label}</option>)}
                </select>
                <button
                  className={pickMode ? "active" : ""}
                  onClick={() => setPickMode((current) => !current)}
                >
                  {pickMode ? "取消点选" : "从画面点选"}
                </button>
              </div>
              {pickMode && <p className="pick-tip">现在点击预览中的人物或物体即可选中；开启直接拖动时无需先点选。</p>}
              {selectedEdit ? (
                <div className="element-editor">
                  <div className="selected-element-name">
                    <span>正在编辑</span>
                    <b>{selectedLayer?.label || "已选网页元素"}</b>
                  </div>
                  <label className="range-row"><span><b>元素大小</b><output>{selectedEdit.scale}%</output></span><input data-testid="element-scale" aria-label="元素大小" type="range" min="10" max="300" value={selectedEdit.scale} onInput={(event) => updateSelectedElement({ scale: Number(event.currentTarget.value) })} /></label>
                  <div className="two-column-ranges">
                    <label className="range-row"><span><b>左右</b><output>{selectedEdit.x}%</output></span><input data-testid="element-x" aria-label="元素左右位置" type="range" min="-60" max="60" value={selectedEdit.x} onInput={(event) => updateSelectedElement({ x: Number(event.currentTarget.value) })} /></label>
                    <label className="range-row"><span><b>上下</b><output>{selectedEdit.y}%</output></span><input data-testid="element-y" aria-label="元素上下位置" type="range" min="-60" max="60" value={selectedEdit.y} onInput={(event) => updateSelectedElement({ y: Number(event.currentTarget.value) })} /></label>
                  </div>
                  <label className="range-row"><span><b>旋转角度</b><output>{selectedEdit.rotation}°</output></span><input type="range" min="-180" max="180" value={selectedEdit.rotation} onInput={(event) => updateSelectedElement({ rotation: Number(event.currentTarget.value) })} /></label>
                  <label className="range-row"><span><b>透明度</b><output>{selectedEdit.opacity}%</output></span><input type="range" min="0" max="100" value={selectedEdit.opacity} onInput={(event) => updateSelectedElement({ opacity: Number(event.currentTarget.value) })} /></label>
                  <label className="range-row"><span><b>前后层级</b><output>{selectedEdit.zIndex}</output></span><input type="range" min="-10" max="100" value={selectedEdit.zIndex} onInput={(event) => updateSelectedElement({ zIndex: Number(event.currentTarget.value) })} /></label>
                  <div className="element-toggles">
                    <label className="toggle-row"><span><b>水平翻转</b></span><input type="checkbox" checked={selectedEdit.flipX} onChange={(event) => updateSelectedElement({ flipX: event.target.checked })} /></label>
                    <label className="toggle-row"><span><b>隐藏元素</b></span><input type="checkbox" checked={selectedEdit.hidden} onChange={(event) => updateSelectedElement({ hidden: event.target.checked })} /></label>
                  </div>
                  <button className="element-reset" onClick={resetSelectedElement}>重置当前元素</button>
                </div>
              ) : (
                <p className="empty-element-state">可从自动识别列表选择，也可以开启点选模式后直接点击预览画面。</p>
              )}
            </div>

            <div className="control-section">
              <div className="section-title"><span>04</span><h2>动态截帧</h2></div>
              <label className="toggle-row"><span><b>运行项目脚本</b><small>用于动画、Canvas 和交互壁纸</small></span><input type="checkbox" checked={runScripts} onChange={(event) => changeScriptMode(event.target.checked)} /></label>
              <label className="range-row delay-row"><span><b>等待时间</b><output>{captureDelay.toFixed(1)} 秒</output></span><input type="range" min="0" max="8" step="0.5" value={captureDelay} onInput={(event) => setCaptureDelay(Number(event.currentTarget.value))} /></label>
              <label className="toggle-row"><span><b>导出前暂停动画</b><small>让最终画面保持静止</small></span><input type="checkbox" checked={freezeAnimations} onChange={(event) => setFreezeAnimations(event.target.checked)} /></label>
            </div>

            <div className="actions">
              <button className="secondary-button" onClick={() => { setZoom(100); setOffsetX(0); setOffsetY(0); }}>重置构图</button>
              <button className="export-button" disabled={isBusy || isExporting || !previewHtml} onClick={exportWallpaper}>{isExporting ? "正在生成…" : "导出静态 PNG"}</button>
            </div>
            <p className="privacy-note">项目在受限预览中运行，不会上传到服务器。导出能力受浏览器截图规则限制。</p>
          </aside>
        </section>
      )}
    </main>
  );
}
