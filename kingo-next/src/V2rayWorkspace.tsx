import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CloudDownloadOutlined,
  CopyOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  DownOutlined,
  DownloadOutlined,
  EditOutlined,
  FieldTimeOutlined,
  HeartOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  NodeIndexOutlined,
  PlusOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  RocketOutlined,
  ScanOutlined,
  VerticalAlignBottomOutlined,
  VerticalAlignTopOutlined,
} from "@ant-design/icons";
import type { AppState } from "./App";
import "./V2rayWorkspace.css";

type NodeItem = {
  id: string;
  subscriptionId: string | null;
  name: string;
  protocol: string;
  host: string;
  port: number;
  coreId: string;
  rawUrl: string;
  details: Record<string, unknown>;
  sort: number;
  active: boolean;
  delay: number | null;
  speed: number | null;
  ipInfo: string | null;
  testMessage: string | null;
  lastTestedAt: number | null;
};

type NodeShare = { nodeId: string; name: string; link: string };
type ImportResult = {
  imported: number;
  skipped: number;
  errors: string[];
  nodes: NodeItem[];
  subscriptions: { subscription: Subscription; imported: number; skipped: number; errors: string[] }[];
};
type TestMode = "tcp" | "real" | "speed" | "udp" | "mixed" | "fast-real";
type TestResult = { nodeId: string; delay: number | null; speed: number | null; ipInfo: string | null; mode: string; message: string };
type TestBatch = { results: TestResult[]; cancelled: boolean };
type TestStart = { total: number };
type ResultFilter = "all" | "available" | "failed" | "untested";
type ContextMenu = { x: number; y: number; node: NodeItem };
type RuntimeSettings = { localPort: number; allowLan: boolean; systemProxy: boolean };

type NodeEditorDraft = {
  name: string;
  protocol: string;
  host: string;
  port: string;
  coreId: string;
  password: string;
  username: string;
  method: string;
  encryption: string;
  alterId: string;
  flow: string;
  muxEnabled: boolean;
  network: string;
  transportHost: string;
  path: string;
  serviceName: string;
  security: string;
  sni: string;
  fingerprint: string;
  alpn: string;
  allowInsecure: boolean;
  publicKey: string;
  shortId: string;
  spiderX: string;
  echConfigList: string;
  verifyPeerCertByName: string;
  cert: string;
  certSha: string;
  finalmask: string;
};

type Subscription = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  userAgent: string;
  filter: string | null;
  updatedAt: number | null;
  nodeCount: number;
  lastError: string | null;
};

type TestProgress = {
  completed: number;
  total: number;
  nodeId: string;
  delay: number | null;
  speed: number | null;
  ipInfo: string | null;
  mode: string;
  message: string;
};

function testSummary(batch: TestBatch) {
  const mode = batch.results[0]?.mode ?? "tcp";
  const succeeded = mode === "speed" || mode === "mixed"
    ? batch.results.filter((item) => item.speed != null).length
    : batch.results.filter((item) => item.delay != null).length;
  const veryLowTcpResults = mode === "tcp"
    ? batch.results.filter((item) => item.delay != null && item.delay <= 2).length
    : 0;
  const tcpResultMayBeIntercepted = mode === "tcp"
    && batch.results.length >= 10
    && veryLowTcpResults >= Math.ceil(batch.results.length / 2);
  if (batch.cancelled) return `????????? ${batch.results.length} ???`;
  if (tcpResultMayBeIntercepted) {
    return `TCP ???????${succeeded}/${batch.results.length}?????? 1-2 ms??????????? TUN ???????????????????`;
  }
  return `?????${succeeded}/${batch.results.length} ?????`;
}

type DialogState =
  | { kind: "import"; text: string }
  | { kind: "node"; nodeId?: string; draft: NodeEditorDraft }
  | {
      kind: "subscription";
      mode: "add" | "edit";
      subscriptionId?: string;
      name: string;
      url: string;
      userAgent: string;
      filter: string;
      enabled: boolean;
    }
  | { kind: "delete-nodes"; nodeIds: string[] }
  | { kind: "delete-subscription"; subscription: Subscription }
  | { kind: "share"; share: NodeShare; qrSvg: string | null };

function detailText(details: Record<string, unknown>, key: string, fallback = "") {
  const value = details[key];
  return value == null ? fallback : String(value);
}

function speedText(value: number | null) {
  if (value == null || value <= 0) return "-";
  return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 1 : 2)} MB/s`;
}

function nodeDraft(node: NodeItem): NodeEditorDraft {
  const details = node.details ?? {};
  return {
    name: node.name,
    protocol: node.protocol,
    host: node.host,
    port: String(node.port),
    coreId: node.coreId,
    password: detailText(details, "password"),
    username: detailText(details, "username"),
    method: detailText(details, "method", "aes-256-gcm"),
    encryption: detailText(details, "encryption", node.protocol === "vmess" ? "auto" : "none"),
    alterId: detailText(details, "alterId", "0"),
    flow: detailText(details, "flow"),
    muxEnabled: details.muxEnabled === true,
    network: detailText(details, "network", "tcp"),
    transportHost: detailText(details, "host"),
    path: detailText(details, "path"),
    serviceName: detailText(details, "serviceName"),
    security: detailText(details, "security", "none"),
    sni: detailText(details, "sni"),
    fingerprint: detailText(details, "fingerprint", "chrome"),
    alpn: detailText(details, "alpn"),
    allowInsecure: details.allowInsecure === true,
    publicKey: detailText(details, "publicKey"),
    shortId: detailText(details, "shortId"),
    spiderX: detailText(details, "spiderX", "/"),
    echConfigList: detailText(details, "echConfigList"),
    verifyPeerCertByName: detailText(details, "verifyPeerCertByName"),
    cert: detailText(details, "cert"),
    certSha: detailText(details, "certSha"),
    finalmask: detailText(details, "finalmask"),
  };
}

function emptyNodeDraft(protocol = "vless"): NodeEditorDraft {
  const requiresSingBox = ["hysteria2", "tuic", "anytls"].includes(protocol);
  return {
    name: "",
    protocol,
    host: "",
    port: "443",
    coreId: requiresSingBox ? "sing-box" : "xray",
    password: "",
    username: "",
    method: "aes-256-gcm",
    encryption: protocol === "vmess" ? "auto" : "none",
    alterId: "0",
    flow: "",
    muxEnabled: false,
    network: "tcp",
    transportHost: "",
    path: "",
    serviceName: "",
    security: ["vless", "vmess", "trojan"].includes(protocol) ? "tls" : "none",
    sni: "",
    fingerprint: "chrome",
    alpn: "",
    allowInsecure: false,
    publicKey: "",
    shortId: "",
    spiderX: "/",
    echConfigList: "",
    verifyPeerCertByName: "",
    cert: "",
    certSha: "",
    finalmask: "",
  };
}

function nodeDetails(draft: NodeEditorDraft): Record<string, unknown> {
  return {
    password: draft.password.trim(),
    username: draft.username.trim(),
    method: draft.method.trim(),
    encryption: draft.encryption.trim(),
    alterId: Number.parseInt(draft.alterId, 10) || 0,
    flow: draft.flow.trim(),
    muxEnabled: draft.muxEnabled,
    network: draft.network,
    host: draft.transportHost.trim(),
    path: draft.path.trim(),
    serviceName: draft.serviceName.trim(),
    security: draft.security,
    sni: draft.sni.trim(),
    fingerprint: draft.fingerprint.trim(),
    alpn: draft.alpn.trim(),
    allowInsecure: draft.allowInsecure,
    publicKey: draft.publicKey.trim(),
    shortId: draft.shortId.trim(),
    spiderX: draft.spiderX.trim(),
    echConfigList: draft.echConfigList.trim(),
    verifyPeerCertByName: draft.verifyPeerCertByName.trim(),
    cert: draft.cert.trim(),
    certSha: draft.certSha.trim(),
    finalmask: draft.finalmask.trim(),
  };
}

export function V2rayWorkspace({
  view,
  state,
  logs,
}: {
  view: "profiles" | "subscriptions" | "help" | "about";
  state: AppState;
  logs: { at: string; level: string; message: string }[];
}) {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings>({ localPort: 10808, allowLan: false, systemProxy: true });
  const [group, setGroup] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [doubleClickAction, setDoubleClickAction] = useState<"edit" | "activate">(
    () => (localStorage.getItem("v2ray-double-click") === "activate" ? "activate" : "edit"),
  );
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<TestProgress | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [speedTestMenuOpen, setSpeedTestMenuOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textFileInputRef = useRef<HTMLInputElement>(null);
  const selectionAnchorRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const [nodeItems, subItems, settings] = await Promise.all([
      invoke<NodeItem[]>("list_v2ray_nodes", { subscriptionId: null }),
      invoke<Subscription[]>("list_v2ray_subscriptions"),
      invoke<RuntimeSettings>("get_v2ray_settings"),
    ]);
    setNodes(nodeItems);
    setSubscriptions(subItems);
    setRuntimeSettings(settings);
  }, []);

  useEffect(() => {
    void refresh().catch((value) => setError(String(value)));
  }, [refresh]);

  useEffect(() => {
    let cleanupProgress: (() => void) | undefined;
    let cleanupComplete: (() => void) | undefined;
    let cleanupError: (() => void) | undefined;
    void listen<TestProgress>("v2ray-test-progress", (event) => {
      setProgress(event.payload);
      setNodes((items) =>
        items.map((item) =>
          item.id === event.payload.nodeId
            ? {
                ...item,
                delay: event.payload.delay,
                speed: event.payload.speed ?? item.speed,
                ipInfo: event.payload.ipInfo ?? item.ipInfo,
                testMessage: event.payload.message,
              }
            : item,
        ),
      );
    }).then((value) => {
      cleanupProgress = value;
    });
    void listen<TestBatch>("v2ray-test-complete", (event) => {
      setBusy((value) => value?.startsWith("test-") ? null : value);
      setProgress(null);
      setNotice(testSummary(event.payload));
      void refresh().catch((value) => setError(String(value)));
    }).then((value) => {
      cleanupComplete = value;
    });
    void listen<string>("v2ray-test-error", (event) => {
      setBusy((value) => value?.startsWith("test-") ? null : value);
      setProgress(null);
      setError(String(event.payload));
    }).then((value) => {
      cleanupError = value;
    });
    return () => {
      cleanupProgress?.();
      cleanupComplete?.();
      cleanupError?.();
    };
  }, [refresh]);

  useEffect(() => {
    const close = () => {
      setContextMenu(null);
      setImportMenuOpen(false);
      setSpeedTestMenuOpen(false);
    };
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, []);

  useEffect(() => {
    if (view !== "profiles") return;
    const paste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (dialog || target?.matches("input, textarea, select, [contenteditable='true']")) return;
      const text = event.clipboardData?.getData("text/plain")?.trim();
      if (!text) return;
      event.preventDefault();
      void importText(text, "???");
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  });

  const visibleNodes = useMemo(() => {
    const grouped = group === "all"
      ? nodes
      : group === "manual"
        ? nodes.filter((item) => item.subscriptionId == null)
        : nodes.filter((item) => item.subscriptionId === group);
    const keyword = filter.trim().toLowerCase();
    const tested = grouped.filter((item) => {
      if (resultFilter === "available") return item.lastTestedAt != null && item.delay != null;
      if (resultFilter === "failed") return item.lastTestedAt != null && item.delay == null;
      if (resultFilter === "untested") return item.lastTestedAt == null;
      return true;
    });
    if (!keyword) return tested;
    return tested.filter((item) =>
      [item.name, item.protocol, item.host, item.coreId]
        .join(" ")
        .toLowerCase()
        .includes(keyword),
    );
  }, [filter, group, nodes, resultFilter]);

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await action();
      await refresh();
    } catch (value) {
      setError(String(value));
    } finally {
      setBusy(null);
    }
  }

  function selectedIds() {
    return Array.from(selected);
  }

  function toggleSelected(id: string) {
    selectionAnchorRef.current = id;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectRow(nodeId: string, event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button, input, select, a")) return;
    if (event.shiftKey && selectionAnchorRef.current) {
      const anchor = visibleNodes.findIndex((node) => node.id === selectionAnchorRef.current);
      const target = visibleNodes.findIndex((node) => node.id === nodeId);
      if (anchor >= 0 && target >= 0) {
        const [start, end] = anchor < target ? [anchor, target] : [target, anchor];
        const range = visibleNodes.slice(start, end + 1).map((node) => node.id);
        setSelected((current) => new Set(event.ctrlKey || event.metaKey ? [...current, ...range] : range));
        return;
      }
    }
    selectionAnchorRef.current = nodeId;
    if (event.ctrlKey || event.metaKey) {
      toggleSelected(nodeId);
    } else {
      setSelected(new Set([nodeId]));
    }
  }

  function handleTableKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).matches("input, textarea, select, button, [contenteditable='true']")) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      setSelected(new Set(visibleNodes.map((node) => node.id)));
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      event.preventDefault();
      if (selected.size) void copyShares();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selected.size) {
      event.preventDefault();
      removeSelected();
    }
  }

  function importLinks() {
    setImportMenuOpen(false);
    setDialogError(null);
    setDialog({ kind: "import", text: "" });
  }

  function importNotice(result: ImportResult, source: string) {
    const subscriptionCount = result.subscriptions.length;
    const subscriptionNodes = result.subscriptions.reduce((sum, item) => sum + item.imported, 0);
    const parts = [];
    if (result.imported) parts.push(`${result.imported} ???`);
    if (subscriptionCount) parts.push(`${subscriptionCount} ????${subscriptionNodes} ????`);
    if (result.skipped) parts.push(`?? ${result.skipped} ?????`);
    if (result.errors.length) parts.push(`${result.errors.length} ????`);
    setNotice(`${source}?????${parts.join("?") || "??????"}`);
    const lastSubscription = result.subscriptions[result.subscriptions.length - 1]?.subscription;
    if (lastSubscription) setGroup(lastSubscription.id);
  }

  async function importText(text: string, source: string) {
    await run("import", async () => {
      const result = await invoke<ImportResult>("import_v2ray_nodes", { text });
      importNotice(result, source);
    });
  }

  async function importClipboard() {
    setImportMenuOpen(false);
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        importLinks();
        setDialogError("????????????");
        return;
      }
      await importText(text, "???");
    } catch {
      importLinks();
      setDialogError("????????????????????");
    }
  }

  async function scanScreenQr() {
    setImportMenuOpen(false);
    await run("scan-screen", async () => {
      const result = await invoke<ImportResult>("scan_v2ray_qr_screen");
      importNotice(result, "?????");
    });
  }

  async function importImage(file: File) {
    await run("scan-image", async () => {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const result = await invoke<ImportResult>("import_v2ray_qr_image", { bytes });
      importNotice(result, "?????");
    });
  }

  async function importTextFile(file: File) {
    const text = await file.text();
    await importText(text, "??");
  }

  function addManualNode(protocol = "vless") {
    setImportMenuOpen(false);
    setDialogError(null);
    setDialog({ kind: "node", draft: emptyNodeDraft(protocol) });
  }

  function addSubscription() {
    setDialogError(null);
    setDialog({
      kind: "subscription",
      mode: "add",
      name: `?? ${subscriptions.length + 1}`,
      url: "",
      userAgent: "v2rayN/7.12.5",
      filter: "",
      enabled: true,
    });
  }

  async function updateSubscriptions() {
    await run("update-subscriptions", async () => {
      if (group !== "all" && group !== "manual") {
        const result = await invoke<{ imported: number }>("update_v2ray_subscription", {
          subscriptionId: group,
        });
        setNotice(`????????${result.imported} ???`);
      } else {
        const result = await invoke<{
          updated: { imported: number }[];
          errors: string[];
        }>(
          "update_all_v2ray_subscriptions",
        );
        setNotice(
          `??? ${result.updated.length} ????? ${result.updated.reduce((sum, item) => sum + item.imported, 0)} ???${result.errors.length ? `?${result.errors.length} ????${result.errors.join("?")}` : ""}`,
        );
      }
    });
  }

  async function testSelected(mode: TestMode, explicitIds?: string[]) {
    if (busy?.startsWith("test-")) {
      setNotice("V2ray??????");
      return;
    }
    const allNodes = mode === "mixed" || mode === "fast-real";
    const nodeIds = explicitIds ?? (allNodes ? nodes.map((item) => item.id) : selected.size ? selectedIds() : visibleNodes.map((item) => item.id));
    setBusy(`test-${mode}`);
    setError(null);
    setNotice(null);
    setProgress(null);
    try {
      const started = await invoke<TestStart>("start_v2ray_tests", { nodeIds, mode });
      setProgress({ completed: 0, total: started.total, nodeId: "", delay: null, speed: null, ipInfo: null, mode, message: "?????" });
      if (started.total === 0) {
        setBusy(null);
        setProgress(null);
        setNotice("????????");
      }
    } catch (value) {
      setBusy(null);
      setProgress(null);
      setError(String(value));
    }
    return;
    setProgress(null);
    await run(`test-${mode}`, async () => {
      const allNodes = mode === "mixed" || mode === "fast-real";
      const batch = await invoke<TestBatch>("test_v2ray_nodes", {
        nodeIds: explicitIds ?? (allNodes ? nodes.map((item) => item.id) : selected.size ? selectedIds() : visibleNodes.map((item) => item.id)),
        mode,
      });
      const succeeded = mode === "speed" || mode === "mixed"
        ? batch.results.filter((item) => item.speed != null).length
        : batch.results.filter((item) => item.delay != null).length;
      const veryLowTcpResults = mode === "tcp"
        ? batch.results.filter((item) => item.delay != null && item.delay <= 2).length
        : 0;
      const tcpResultMayBeIntercepted = mode === "tcp"
        && batch.results.length >= 10
        && veryLowTcpResults >= Math.ceil(batch.results.length / 2);
      setNotice(batch.cancelled
        ? `????????? ${batch.results.length} ???`
        : tcpResultMayBeIntercepted
          ? `TCP ???????${succeeded}/${batch.results.length}?????? 1?2 ms??????????? TUN ???????????????????`
          : `?????${succeeded}/${batch.results.length} ?????`);
      setProgress(null);
    });
  }

  async function cancelTests() {
    await invoke("cancel_v2ray_tests");
    setNotice("???????");
  }

  function editNode(node: NodeItem) {
    setDialogError(null);
    setDialog({
      kind: "node",
      nodeId: node.id,
      draft: nodeDraft(node),
    });
  }

  async function moveSelected(direction: "top" | "bottom" | "up" | "down") {
    if (!selected.size) return;
    await run(`move-${direction}`, async () => {
      await invoke("move_v2ray_nodes", { nodeIds: selectedIds(), direction });
      setNotice({ top: "?????", bottom: "?????", up: "???", down: "???" }[direction]);
    });
  }

  async function setActive(node: NodeItem) {
    setContextMenu(null);
    const switchingRunningNode = state.mode === "v2ray" && state.connected && !node.active;
    await run("active", async () => {
      await invoke("set_active_v2ray_node", { nodeId: node.id });
      setNotice(switchingRunningNode ? `???? ${node.name}?V2ray ?????` : `??? ${node.name}`);
    });
  }

  async function showShare(node: NodeItem) {
    setContextMenu(null);
    setBusy("share");
    setError(null);
    try {
      const [share] = await invoke<NodeShare[]>("share_v2ray_nodes", { nodeIds: [node.id] });
      const qrSvg = await invoke<string>("qrcode_v2ray_node", { nodeId: node.id });
      setDialog({ kind: "share", share, qrSvg });
    } catch (value) {
      setError(String(value));
    } finally {
      setBusy(null);
    }
  }

  async function copyShares(nodeIds = selectedIds()) {
    const ids = nodeIds.length ? nodeIds : visibleNodes.map((node) => node.id);
    await run("copy", async () => {
      const shares = await invoke<NodeShare[]>("share_v2ray_nodes", { nodeIds: ids });
      await navigator.clipboard.writeText(shares.map((item) => item.link).join("\n"));
      setNotice(`??? ${shares.length} ???????`);
    });
  }

  async function exportNodes() {
    const ids = selected.size ? selectedIds() : visibleNodes.map((node) => node.id);
    await run("export", async () => {
      const path = await invoke<string>("export_v2ray_nodes", { nodeIds: ids });
      setNotice(`???? ${path}`);
    });
  }

  async function removeDuplicates() {
    await run("dedupe", async () => {
      const count = await invoke<number>("remove_duplicate_v2ray_nodes");
      setNotice(count ? `??? ${count} ?????` : "????????");
    });
  }

  async function duplicateNodes(node: NodeItem) {
    setContextMenu(null);
    const ids = selected.has(node.id) && selected.size > 1 ? selectedIds() : [node.id];
    await run("duplicate", async () => {
      for (const nodeId of ids) await invoke("duplicate_v2ray_node", { nodeId });
      setNotice(ids.length === 1 ? `??? ${node.name} ???` : `??? ${ids.length} ?????`);
    });
  }

  async function moveNodeToGroup(node: NodeItem, subscriptionId: string | null) {
    setContextMenu(null);
    await run("move-group", async () => {
      await invoke("move_v2ray_node_group", { nodeId: node.id, subscriptionId });
      setNotice("???????");
    });
  }

  async function sortNodes(by: string) {
    await run("sort", async () => {
      await invoke("sort_v2ray_nodes", { by });
      setNotice("???????");
    });
  }

  async function dropNode(targetId: string) {
    if (!draggedNodeId || draggedNodeId === targetId) return;
    const order = nodes.map((node) => node.id);
    const from = order.indexOf(draggedNodeId);
    const to = order.indexOf(targetId);
    if (from < 0 || to < 0) return;
    order.splice(to, 0, order.splice(from, 1)[0]);
    setDraggedNodeId(null);
    await run("reorder", () => invoke("reorder_v2ray_nodes", { nodeIds: order }));
    setNotice("???????");
  }

  function handleDoubleClick(node: NodeItem) {
    if (doubleClickAction === "edit") editNode(node);
    else void setActive(node);
  }

  function editSubscription(subscription: Subscription) {
    setDialogError(null);
    setDialog({
      kind: "subscription",
      mode: "edit",
      subscriptionId: subscription.id,
      name: subscription.name,
      url: subscription.url,
      userAgent: subscription.userAgent,
      filter: subscription.filter ?? "",
      enabled: subscription.enabled,
    });
  }

  async function connectNode(node?: NodeItem) {
    const target = node ?? nodes.find((item) => selected.has(item.id)) ?? nodes.find((item) => item.active);
    if (!target) {
      setError("????????");
      return;
    }
    await run("connect", async () => {
      await invoke("start_v2ray_connection", { nodeId: target.id });
      setNotice(`??? ${target.name}`);
    });
  }

  function removeSelected() {
    const ids = selectedIds();
    if (!ids.length) return;
    setDialogError(null);
    setDialog({ kind: "delete-nodes", nodeIds: ids });
  }

  function removeSubscription(subscription: Subscription) {
    setDialogError(null);
    setDialog({ kind: "delete-subscription", subscription });
  }

  async function submitDialog() {
    if (!dialog) return;
    setBusy("dialog");
    setDialogError(null);
    setError(null);
    try {
      if (dialog.kind === "import") {
        if (!dialog.text.trim()) throw new Error("?????????????");
        const result = await invoke<ImportResult>(
          "import_v2ray_nodes",
          { text: dialog.text },
        );
        importNotice(result, "??");
      } else if (dialog.kind === "node") {
        const draft = dialog.draft;
        if (!draft.name.trim()) throw new Error("????????");
        if (!draft.host.trim()) throw new Error("?????????");
        const port = Number(draft.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("???????? 1 ? 65535 ??");
        if (["vmess", "vless", "trojan", "shadowsocks", "hysteria2", "anytls"].includes(draft.protocol) && !draft.password.trim()) {
          throw new Error(draft.protocol === "vless" || draft.protocol === "vmess" ? "?? ID ????" : "??????");
        }
        if (draft.security === "reality" && !draft.publicKey.trim()) throw new Error("Reality ??????");
        const input = {
          name: draft.name.trim(),
          protocol: draft.protocol,
          host: draft.host.trim(),
          port,
          coreId: draft.coreId,
          details: nodeDetails(draft),
        };
        if (dialog.nodeId) {
          await invoke("update_v2ray_node", { nodeId: dialog.nodeId, input });
          setNotice("???????");
        } else {
          await invoke("create_v2ray_node", { input });
          setNotice("?????");
        }
      } else if (dialog.kind === "subscription") {
        if (!dialog.name.trim()) throw new Error("????????");
        if (!/^https?:\/\//i.test(dialog.url.trim())) throw new Error("??????? http:// ? https:// ??");
        if (dialog.mode === "add") {
          const subscription = await invoke<Subscription>("add_v2ray_subscription", {
            name: dialog.name.trim(),
            url: dialog.url.trim(),
            userAgent: dialog.userAgent.trim() || "v2rayN/7.12.5",
          });
          setDialog(null);
          try {
            const result = await invoke<{ imported: number }>("update_v2ray_subscription", { subscriptionId: subscription.id });
            setGroup(subscription.id);
            setNotice(`???????? ${result.imported} ???`);
          } catch (value) {
            setError(`??????????????${String(value)}`);
          }
          await refresh();
          return;
        }
        await invoke("update_v2ray_subscription_settings", {
          subscriptionId: dialog.subscriptionId,
          input: {
            name: dialog.name.trim(),
            url: dialog.url.trim(),
            enabled: dialog.enabled,
            userAgent: dialog.userAgent.trim() || "v2rayN/7.12.5",
            filter: dialog.filter.trim(),
          },
        });
        setNotice("??????????????????");
      } else if (dialog.kind === "delete-nodes") {
        await invoke("delete_v2ray_nodes", { nodeIds: dialog.nodeIds });
        setSelected(new Set());
        setNotice(`??? ${dialog.nodeIds.length} ???`);
      } else if (dialog.kind === "delete-subscription") {
        await invoke("delete_v2ray_subscription", { subscriptionId: dialog.subscription.id });
        setGroup("all");
        setNotice("?????");
      }
      setDialog(null);
      await refresh();
    } catch (value) {
      setDialogError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(null);
    }
  }

  async function updateOneSubscription(subscription: Subscription) {
    await run("update-subscription", async () => {
      const result = await invoke<{ imported: number }>("update_v2ray_subscription", {
        subscriptionId: subscription.id,
      });
      setNotice(`???${subscription.name}?????${result.imported} ???`);
    });
  }

  async function toggleSubscription(subscription: Subscription) {
    await run("toggle-subscription", async () => {
      await invoke("update_v2ray_subscription_settings", {
        subscriptionId: subscription.id,
        input: {
          name: subscription.name,
          url: subscription.url,
          enabled: !subscription.enabled,
          userAgent: subscription.userAgent,
          filter: subscription.filter,
        },
      });
      setNotice(subscription.enabled ? "???????????" : "??????");
    });
  }

  const testingBusy = busy?.startsWith("test-") === true;
  const actionBusy = busy != null && !testingBusy;

  if (view === "subscriptions") {
    return (
      <div className="page v2ray-workspace v2ray-section-page">
        <section className="v2ray-section-heading">
          <div><h2>????</h2><p>????????????User-Agent ?????</p></div>
          <div><button className="primary-button" onClick={() => void addSubscription()}><PlusOutlined /> ????</button><button onClick={() => void updateSubscriptions()} disabled={!subscriptions.length || actionBusy}><ReloadOutlined /> ????</button></div>
        </section>
        <Messages notice={notice} error={error ?? state.error} />
        <section className="v2ray-subscription-list">
          {subscriptions.map((subscription) => (
            <article key={subscription.id}>
              <div className="v2ray-subscription-main"><span className={subscription.enabled ? "subscription-dot enabled" : "subscription-dot"} /><div><b>{subscription.name}</b><p>{subscription.url}</p><small>{subscription.nodeCount} ??? ? User-Agent: {subscription.userAgent || "v2rayN/7.12.5"}{subscription.filter ? ` ? ???${subscription.filter}` : ""}</small>{subscription.lastError && <em>{subscription.lastError}</em>}</div></div>
              <div className="v2ray-subscription-actions"><button onClick={() => void updateOneSubscription(subscription)} disabled={actionBusy}><ReloadOutlined /> ??</button><button onClick={() => void editSubscription(subscription)}><EditOutlined /> ??</button><button onClick={() => void toggleSubscription(subscription)}>{subscription.enabled ? "??" : "??"}</button><button className="danger-button" onClick={() => void removeSubscription(subscription)}><DeleteOutlined /></button></div>
            </article>
          ))}
          {!subscriptions.length && <div className="v2ray-empty"><CloudDownloadOutlined /><b>???????</b><p>???????????????????????</p><button className="primary-button" onClick={() => void addSubscription()}><PlusOutlined /> ????</button></div>}
        </section>
        <V2rayDialog dialog={dialog} error={dialogError} busy={busy === "dialog"} onChange={setDialog} onCancel={() => setDialog(null)} onSubmit={() => void submitDialog()} />
      </div>
    );
  }

  if (view === "help" || view === "about") {
    return (
      <div className="page v2ray-workspace v2ray-section-page">
        <section className="v2ray-info-page">
          <span>{view === "help" ? <InfoCircleOutlined /> : <HeartOutlined />}</span>
          <h2>{view === "help" ? "V2ray ????" : "?? KiNGO"}</h2>
          {view === "help" ? <><p>????????????????????????????????????????????????</p><ul><li>TCP ???????????????</li><li>??????????????????????????????? IP?</li><li>????????????????????????????????????</li><li>UDP ???? SOCKS5 UDP ??????? UDP ?????</li><li>????????????????????????????</li></ul></> : <><p>KiNGO ???????????????????</p><p>V2ray ???????????????????????????? Xray / sing-box ???</p></>}
        </section>
      </div>
    );
  }

  return (
    <div className="page v2ray-workspace">
      <section className="v2ray-commandbar">
        <div className="v2ray-import-split" onClick={(event) => event.stopPropagation()}>
          <button onClick={() => void importClipboard()} disabled={actionBusy} title="???????????Ctrl+V?"><PlusOutlined /> ????</button>
          <button className="v2ray-import-caret" onClick={() => setImportMenuOpen((open) => !open)} disabled={actionBusy} aria-label="??????"><DownOutlined /></button>
          {importMenuOpen && <div className="v2ray-import-menu">
            <button onClick={() => void importClipboard()}><CopyOutlined /><span><b>??????</b><small>Ctrl+V</small></span></button>
            <button onClick={() => void scanScreenQr()}><ScanOutlined /><span><b>???????</b><small>???????</small></span></button>
            <button onClick={() => { setImportMenuOpen(false); imageInputRef.current?.click(); }}><QrcodeOutlined /><span><b>???????</b><small>PNG?JPG?WebP</small></span></button>
            <button onClick={() => { setImportMenuOpen(false); textFileInputRef.current?.click(); }}><DownloadOutlined /><span><b>??????</b><small>????? Base64 ??</small></span></button>
            <button onClick={() => importLinks()}><EditOutlined /><span><b>??????</b><small>?????????</small></span></button>
            <button onClick={() => addManualNode()}><PlusOutlined /><span><b>??????</b><small>?????????</small></span></button>
          </div>}
          <input ref={imageInputRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/bmp" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importImage(file); }} />
          <input ref={textFileInputRef} hidden type="file" accept=".txt,.conf,.list,text/plain" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importTextFile(file); }} />
        </div>
        <button onClick={() => void testSelected("tcp")} disabled={!visibleNodes.length || testingBusy}><FieldTimeOutlined /> TCP ??</button>
        <button onClick={() => void testSelected("real")} disabled={!visibleNodes.length || testingBusy}><RocketOutlined /> ????</button>
        <button onClick={() => void testSelected("speed")} disabled={!visibleNodes.length || testingBusy}><DownloadOutlined /> ????</button>
        <button onClick={() => void testSelected("mixed")} disabled={!nodes.length || testingBusy}><RocketOutlined /> ????</button>
        <div className="v2ray-speedtest-more" onClick={(event) => event.stopPropagation()}>
          <button onClick={() => setSpeedTestMenuOpen((open) => !open)} disabled={!nodes.length || testingBusy}>???? <DownOutlined /></button>
          {speedTestMenuOpen && <div className="v2ray-speedtest-menu">
            <button onClick={() => { setSpeedTestMenuOpen(false); void testSelected("udp"); }}><b>UDP ??</b><small>???? UDP ???????</small></button>
            <button onClick={() => { setSpeedTestMenuOpen(false); void testSelected("fast-real"); }}><b>??????</b><small>?????????????</small></button>
          </div>}
        </div>
        {testingBusy && <button className="danger-button" onClick={() => void cancelTests()}>????</button>}
        <button onClick={() => void copyShares()} disabled={!visibleNodes.length || actionBusy}><CopyOutlined /> ????</button>
        <button onClick={() => void exportNodes()} disabled={!visibleNodes.length || actionBusy}><DownloadOutlined /> ??</button>
        {state.mode === "v2ray" && (state.connected || state.connecting) ? (
          <button className="danger-button" disabled={actionBusy} onClick={() => void run("disconnect", () => invoke("stop_v2ray_connection"))}><DisconnectOutlined /> ??</button>
        ) : (
          <button className="primary-button" disabled={!nodes.length || actionBusy} onClick={() => void connectNode()}><RocketOutlined /> ????</button>
        )}
      </section>
      <section className="v2ray-group-tabs">
        <button className={group === "all" ? "active" : ""} onClick={() => { setGroup("all"); setSelected(new Set()); }}>?? <em>{nodes.length}</em></button>
        <button className={group === "manual" ? "active" : ""} onClick={() => { setGroup("manual"); setSelected(new Set()); }}>????</button>
          {subscriptions.map((subscription) => (
            <div className="v2ray-sub-row" key={subscription.id}>
              <button className={group === subscription.id ? "active" : ""} onClick={() => { setGroup(subscription.id); setSelected(new Set()); }} title={subscription.lastError ?? subscription.url}>
                <span>{subscription.name}</span><em>{subscription.nodeCount}</em>
              </button>
              <button className="v2ray-sub-delete" title="????" onClick={() => void editSubscription(subscription)}><EditOutlined /></button>
              <button className="v2ray-sub-delete" title="????" onClick={() => void removeSubscription(subscription)}><DeleteOutlined /></button>
            </div>
          ))}
      </section>
      <div className="v2ray-layout">
        <section className="v2ray-nodes-panel">
          <div className="v2ray-toolbar">
            <div className="v2ray-filter-controls">
              <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="?????????????" />
              <select value={resultFilter} onChange={(event) => setResultFilter(event.target.value as ResultFilter)} title="??????">
                <option value="all">????</option><option value="available">??</option><option value="failed">??</option><option value="untested">???</option>
              </select>
              <select defaultValue="" onChange={(event) => { if (event.target.value) void sortNodes(event.target.value); event.target.value = ""; }} title="??">
                <option value="">??</option><option value="name">???</option><option value="protocol">???</option><option value="delay">???</option><option value="subscription">???</option>
              </select>
              <select value={doubleClickAction} onChange={(event) => { const value = event.target.value as "edit" | "activate"; setDoubleClickAction(value); localStorage.setItem("v2ray-double-click", value); }} title="???????">
                <option value="edit">????</option><option value="activate">????</option>
              </select>
            </div>
            <div>
              <button onClick={() => void moveSelected("up")} disabled={!selected.size || actionBusy} title="??"><ArrowUpOutlined /></button>
              <button onClick={() => void moveSelected("down")} disabled={!selected.size || actionBusy} title="??"><ArrowDownOutlined /></button>
              <button onClick={() => void moveSelected("top")} disabled={!selected.size || actionBusy} title="????"><VerticalAlignTopOutlined /></button>
              <button onClick={() => void moveSelected("bottom")} disabled={!selected.size || actionBusy} title="????"><VerticalAlignBottomOutlined /></button>
              <button onClick={() => void removeDuplicates()} disabled={!nodes.length || actionBusy} title="??????">??</button>
              <button className="danger-button" onClick={() => { const ids = nodes.filter((node) => node.lastTestedAt != null && node.delay == null).map((node) => node.id); if (ids.length) setDialog({ kind: "delete-nodes", nodeIds: ids }); else setNotice("?????????"); }} disabled={actionBusy} title="?????????">???</button>
              <button className="danger-button" onClick={() => void removeSelected()} disabled={!selected.size || actionBusy}><DeleteOutlined /></button>
            </div>
          </div>
          {progress && <div className="v2ray-test-progress"><LoadingOutlined spin /> ???? {progress.completed}/{progress.total} ? {progress.message}{progress.speed ? ` ? ${speedText(progress.speed)}` : ""}</div>}
          <Messages notice={notice} error={error ?? state.error} />
          <div className="v2ray-table" tabIndex={0} onKeyDown={handleTableKeyDown}>
            <div className="v2ray-table-head"><span><input type="checkbox" checked={visibleNodes.length > 0 && visibleNodes.every((item) => selected.has(item.id))} onChange={(event) => setSelected(event.target.checked ? new Set(visibleNodes.map((item) => item.id)) : new Set())} /></span><span>??</span><span>??</span><span>??</span><span>??</span><span>??</span><span>??</span><span>??</span><span>??</span></div>
            {visibleNodes.map((node) => (
              <div
                className={`${node.active ? "v2ray-table-row active" : "v2ray-table-row"}${selected.has(node.id) ? " selected" : ""}${draggedNodeId === node.id ? " dragging" : ""}`}
                key={node.id}
                tabIndex={0}
                draggable={resultFilter === "all" && !filter.trim()}
                onDragStart={() => setDraggedNodeId(node.id)}
                onDragEnd={() => setDraggedNodeId(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => void dropNode(node.id)}
                onClick={(event) => selectRow(node.id, event)}
                onDoubleClick={() => handleDoubleClick(node)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && event.target === event.currentTarget) {
                    event.preventDefault();
                    void setActive(node);
                  }
                }}
                onContextMenu={(event) => { event.preventDefault(); if (!selected.has(node.id)) { setSelected(new Set([node.id])); selectionAnchorRef.current = node.id; } setContextMenu({ x: event.clientX, y: event.clientY, node }); }}
              >
                <span><input type="checkbox" checked={selected.has(node.id)} onClick={(event) => event.stopPropagation()} onChange={() => toggleSelected(node.id)} /></span>
                <span><i className={`protocol ${node.protocol}`}>{node.protocol.toUpperCase()}</i></span>
                <span className="node-name" title={node.testMessage ?? node.name}><b>{node.name}</b></span>
                <span className={node.delay == null ? "node-delay muted" : "node-delay"}>{node.delay == null ? "??" : `${node.delay} ms`}</span>
                <span className={node.speed == null ? "node-speed muted" : "node-speed"}>{speedText(node.speed)}</span>
                <span className="node-address">{node.host}:{node.port}</span>
                <span className="node-ip-info" title={node.ipInfo ?? ""}>{node.ipInfo ?? "-"}</span>
                <span>{node.coreId}</span>
                <span className="node-actions"><button title="????" onClick={() => void editNode(node)}><EditOutlined /></button><button title="????" onClick={() => void showShare(node)}><QrcodeOutlined /></button><button title="??????" onClick={() => void setActive(node)}>{node.active ? "???" : "??"}</button><button title="??" onClick={() => void connectNode(node)}><RocketOutlined /></button></span>
              </div>
            ))}
            {!visibleNodes.length && <div className="v2ray-empty"><NodeIndexOutlined /><b>????????</b><p>??????????????????????</p><button className="primary-button" onClick={() => void importClipboard()}><PlusOutlined /> ??????</button></div>}
          </div>
        </section>
      </div>
      <section className="v2ray-log-panel">
        <header><b>????</b><span>{state.mode === "v2ray" ? `${state.coreId ?? "-"} ? ${state.stage}` : "V2ray ?????"}</span></header>
        <div className="v2ray-log-lines">
          {logs.length ? logs.slice(-8).map((item, index) => <p key={`${item.at}-${index}`} className={`level-${item.level}`}><time>{item.at}</time> {item.message}</p>) : <p className="muted">???????????????????????????????</p>}
        </div>
      </section>
      <footer className="v2ray-statusbar">
        <span>?? SOCKS?{runtimeSettings.allowLan ? "0.0.0.0" : "127.0.0.1"}:{runtimeSettings.localPort}</span>
        <span>?????{!runtimeSettings.systemProxy ? "???" : state.mode === "v2ray" && state.connected ? "???" : "???"}</span>
        <span>?????{state.mode === "v2ray" ? state.displayName ?? "-" : nodes.find((item) => item.active)?.name ?? "-"}</span>
        <span>???{state.mode === "v2ray" ? state.exitIp ?? "-" : "-"}</span>
      </footer>
      <V2rayDialog dialog={dialog} error={dialogError} busy={busy === "dialog"} onChange={setDialog} onCancel={() => setDialog(null)} onSubmit={() => void submitDialog()} />
      {contextMenu && <div className="v2ray-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
        <button onClick={() => editNode(contextMenu.node)}><EditOutlined /> ????</button>
        <button onClick={() => void setActive(contextMenu.node)}>??????</button>
        <button onClick={() => void testSelected("tcp", [contextMenu.node.id])}><FieldTimeOutlined /> ????</button>
        <button onClick={() => void testSelected("real", [contextMenu.node.id])}><RocketOutlined /> ????</button>
        <button onClick={() => void testSelected("speed", [contextMenu.node.id])}><DownloadOutlined /> ????</button>
        <button onClick={() => void testSelected("udp", [contextMenu.node.id])}>UDP ??</button>
        <button onClick={() => void showShare(contextMenu.node)}><QrcodeOutlined /> ?? / ???</button>
        <button onClick={() => void duplicateNodes(contextMenu.node)}><CopyOutlined /> {selected.has(contextMenu.node.id) && selected.size > 1 ? `?? ${selected.size} ???` : "????"}</button>
        <label>?????<select value={contextMenu.node.subscriptionId ?? "manual"} onChange={(event) => void moveNodeToGroup(contextMenu.node, event.target.value === "manual" ? null : event.target.value)}><option value="manual">????</option>{subscriptions.map((subscription) => <option value={subscription.id} key={subscription.id}>{subscription.name}</option>)}</select></label>
        <button className="danger-button" onClick={() => { setDialog({ kind: "delete-nodes", nodeIds: [contextMenu.node.id] }); setContextMenu(null); }}><DeleteOutlined /> ????</button>
      </div>}
    </div>
  );
}

function V2rayDialog({
  dialog,
  error,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: {
  dialog: DialogState | null;
  error: string | null;
  busy: boolean;
  onChange: (value: DialogState | null) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  useEffect(() => {
    if (!dialog || busy) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, dialog, onCancel]);
  if (!dialog) return null;
  const destructive = dialog.kind === "delete-nodes" || dialog.kind === "delete-subscription";
  const title = dialog.kind === "import"
    ? "????"
    : dialog.kind === "node"
      ? dialog.nodeId ? "????" : "??????"
      : dialog.kind === "subscription"
        ? dialog.mode === "add" ? "????" : "????"
        : dialog.kind === "share"
          ? "????"
          : dialog.kind === "delete-nodes" ? "????" : "????";
  return (
    <div className="v2ray-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <form className={`v2ray-modal${dialog.kind === "node" ? " node-editor" : ""}`} role="dialog" aria-modal="true" aria-label={title} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <header><div><b>{title}</b><small>{dialog.kind === "import" ? "???????????? Base64 ??" : dialog.kind === "share" ? dialog.share.name : destructive ? "???????" : "???????"}</small></div><button type="button" aria-label="??" disabled={busy} onClick={onCancel}>?</button></header>
        <div className="v2ray-modal-body">
          {dialog.kind === "import" && <label><span>???????</span><textarea autoFocus rows={9} value={dialog.text} onChange={(event) => onChange({ ...dialog, text: event.target.value })} placeholder={"vless://...\nvmess://...\nhttps://example.com/subscription"} /></label>}
          {dialog.kind === "node" && <NodeEditor creating={!dialog.nodeId} draft={dialog.draft} onChange={(draft) => onChange({ ...dialog, draft })} />}
          {dialog.kind === "subscription" && <><label><span>????</span><input autoFocus value={dialog.name} onChange={(event) => onChange({ ...dialog, name: event.target.value })} /></label><label><span>????</span><input value={dialog.url} onChange={(event) => onChange({ ...dialog, url: event.target.value })} placeholder="https://example.com/subscription" /></label><div className="v2ray-modal-grid"><label><span>User-Agent</span><input value={dialog.userAgent} onChange={(event) => onChange({ ...dialog, userAgent: event.target.value })} /></label><label><span>??????</span><input value={dialog.filter} onChange={(event) => onChange({ ...dialog, filter: event.target.value })} placeholder="???????" /></label></div>{dialog.mode === "edit" && <label className="v2ray-check"><input type="checkbox" checked={dialog.enabled} onChange={(event) => onChange({ ...dialog, enabled: event.target.checked })} /><span>??????</span></label>}</>}
          {dialog.kind === "delete-nodes" && <p className="v2ray-confirm-text">??????? <b>{dialog.nodeIds.length}</b> ?????</p>}
          {dialog.kind === "delete-subscription" && <p className="v2ray-confirm-text">???????<b>{dialog.subscription.name}</b>??? {dialog.subscription.nodeCount} ?????</p>}
          {dialog.kind === "share" && <div className="v2ray-share-dialog">
            {dialog.qrSvg && <div className="v2ray-qr" dangerouslySetInnerHTML={{ __html: dialog.qrSvg }} />}
            <label><span>????</span><textarea rows={4} readOnly value={dialog.share.link} /></label>
          </div>}
          {error && <div className="v2ray-modal-error">{error}</div>}
        </div>
        <footer>{dialog.kind === "share" ? <><button type="button" onClick={onCancel}>??</button><button type="button" className="primary-button" onClick={() => void navigator.clipboard.writeText(dialog.share.link)}><CopyOutlined /> ????</button></> : <><button type="button" disabled={busy} onClick={onCancel}>??</button><button type="submit" disabled={busy} className={destructive ? "danger-button" : "primary-button"}>{busy ? <LoadingOutlined spin /> : null} {destructive ? "????" : dialog.kind === "import" ? "????" : "??"}</button></>}</footer>
      </form>
    </div>
  );
}

function NodeEditor({ draft, onChange, creating = false }: { draft: NodeEditorDraft; onChange: (draft: NodeEditorDraft) => void; creating?: boolean }) {
  const set = <K extends keyof NodeEditorDraft>(key: K, value: NodeEditorDraft[K]) => onChange({ ...draft, [key]: value });
  const credentialLabel = draft.protocol === "vmess" || draft.protocol === "vless" ? "?? ID" : "??";
  const hasTransport = ["vmess", "vless", "trojan"].includes(draft.protocol);
  const hasTls = ["vmess", "vless", "trojan", "hysteria2", "tuic", "anytls"].includes(draft.protocol);
  const requiresSingBox = ["hysteria2", "tuic", "anytls"].includes(draft.protocol);
  return (
    <div className="v2ray-node-editor">
      <section>
        <h3>???</h3>
        <div className="v2ray-modal-grid three">
          <label><span>????</span>{creating ? <select value={draft.protocol} onChange={(event) => onChange({ ...emptyNodeDraft(event.target.value), name: draft.name, host: draft.host, port: draft.port })}><option value="vless">VLESS</option><option value="vmess">VMess</option><option value="trojan">Trojan</option><option value="shadowsocks">Shadowsocks</option><option value="socks">SOCKS</option><option value="http">HTTP</option><option value="hysteria2">Hysteria2</option><option value="tuic">TUIC</option><option value="anytls">AnyTLS</option></select> : <input value={draft.protocol.toUpperCase()} readOnly />}</label>
          <label><span>????</span><select value={draft.coreId} onChange={(event) => set("coreId", event.target.value)}><option value="xray" disabled={requiresSingBox}>Xray</option><option value="sing-box">sing-box</option></select></label>
          <label><span>???remarks?</span><input autoFocus value={draft.name} onChange={(event) => set("name", event.target.value)} /></label>
          <label className="span-two"><span>???address?</span><input value={draft.host} onChange={(event) => set("host", event.target.value)} /></label>
          <label><span>???port?</span><input type="number" min="1" max="65535" value={draft.port} onChange={(event) => set("port", event.target.value)} /></label>
        </div>
      </section>

      <section>
        <h3>????</h3>
        <div className="v2ray-modal-grid">
          {(draft.protocol === "socks" || draft.protocol === "http" || draft.protocol === "tuic") && <label><span>{draft.protocol === "tuic" ? "?? ID?UUID?" : "???"}</span><div className="v2ray-input-action"><input value={draft.username} onChange={(event) => set("username", event.target.value)} />{draft.protocol === "tuic" && <button type="button" onClick={() => set("username", crypto.randomUUID())}>??</button>}</div></label>}
          {draft.protocol === "shadowsocks" && <label><span>?????method?</span><input value={draft.method} onChange={(event) => set("method", event.target.value)} /></label>}
          <label><span>{credentialLabel}</span><div className="v2ray-input-action"><input value={draft.password} onChange={(event) => set("password", event.target.value)} />{(draft.protocol === "vmess" || draft.protocol === "vless") && <button type="button" onClick={() => set("password", crypto.randomUUID())}>??</button>}</div></label>
          {draft.protocol === "vmess" && <><label><span>Alter ID</span><input type="number" min="0" value={draft.alterId} onChange={(event) => set("alterId", event.target.value)} /></label><label><span>?????encryption?</span><input value={draft.encryption} onChange={(event) => set("encryption", event.target.value)} /></label></>}
          {draft.protocol === "vless" && <><label><span>???flow?</span><select value={draft.flow} onChange={(event) => set("flow", event.target.value)}><option value="">?</option><option value="xtls-rprx-vision">xtls-rprx-vision</option></select></label><label><span>?????encryption?</span><input value={draft.encryption} onChange={(event) => set("encryption", event.target.value)} /></label></>}
        </div>
        {["vmess", "vless", "trojan", "shadowsocks"].includes(draft.protocol) && <label className="v2ray-check"><input type="checkbox" checked={draft.muxEnabled} onChange={(event) => set("muxEnabled", event.target.checked)} /><span>?? Mux ????</span></label>}
      </section>

      {hasTransport && <section>
        <h3>???????transport?</h3>
        <div className="v2ray-modal-grid">
          <label><span>?????network?</span><select value={draft.network} onChange={(event) => set("network", event.target.value)}><option value="tcp">tcp</option><option value="ws">ws</option><option value="grpc">grpc</option><option value="httpupgrade">httpupgrade</option><option value="xhttp">xhttp</option></select></label>
          {draft.network !== "tcp" && <label><span>Host</span><input value={draft.transportHost} onChange={(event) => set("transportHost", event.target.value)} /></label>}
          {["ws", "httpupgrade", "xhttp"].includes(draft.network) && <label><span>???path?</span><input value={draft.path} onChange={(event) => set("path", event.target.value)} /></label>}
          {draft.network === "grpc" && <label><span>Service Name</span><input value={draft.serviceName} onChange={(event) => set("serviceName", event.target.value)} /></label>}
          <label><span>Finalmask</span><input value={draft.finalmask} onChange={(event) => set("finalmask", event.target.value)} /></label>
        </div>
      </section>}

      {hasTls && <section>
        <h3>??????TLS?</h3>
        <div className="v2ray-modal-grid">
          <label><span>????</span><select value={draft.security} onChange={(event) => set("security", event.target.value)}><option value="none">none</option><option value="tls">tls</option>{(draft.protocol === "vless" || draft.protocol === "trojan") && <option value="reality">reality</option>}</select></label>
          <label><span>SNI</span><input value={draft.sni} onChange={(event) => set("sni", event.target.value)} /></label>
          <label><span>Fingerprint</span><select value={draft.fingerprint} onChange={(event) => set("fingerprint", event.target.value)}><option value="chrome">chrome</option><option value="firefox">firefox</option><option value="safari">safari</option><option value="edge">edge</option><option value="random">random</option><option value="">??</option></select></label>
          <label><span>ALPN</span><input value={draft.alpn} onChange={(event) => set("alpn", event.target.value)} placeholder="h2,http/1.1" /></label>
          {draft.security === "reality" && <><label><span>Public Key</span><input value={draft.publicKey} onChange={(event) => set("publicKey", event.target.value)} /></label><label><span>Short ID</span><input value={draft.shortId} onChange={(event) => set("shortId", event.target.value)} /></label><label><span>Spider X</span><input value={draft.spiderX} onChange={(event) => set("spiderX", event.target.value)} /></label></>}
          <label><span>ECH Config List</span><input value={draft.echConfigList} onChange={(event) => set("echConfigList", event.target.value)} /></label>
          <label><span>Verify Peer Cert By Name</span><input value={draft.verifyPeerCertByName} onChange={(event) => set("verifyPeerCertByName", event.target.value)} /></label>
          <label><span>???? SHA-256</span><input value={draft.certSha} onChange={(event) => set("certSha", event.target.value)} /></label>
          <label className="span-two"><span>?????PEM?</span><textarea rows={4} value={draft.cert} onChange={(event) => set("cert", event.target.value)} placeholder="-----BEGIN CERTIFICATE-----" /></label>
        </div>
        <label className="v2ray-check"><input type="checkbox" checked={draft.allowInsecure} onChange={(event) => set("allowInsecure", event.target.checked)} /><span>???????allowInsecure?</span></label>
      </section>}
    </div>
  );
}

function Messages({ notice, error }: { notice?: string | null; error?: string | null }) {
  return <>{notice && <div className="v2ray-message success">{notice}</div>}{error && <div className="v2ray-message error">{error}</div>}</>;
}
