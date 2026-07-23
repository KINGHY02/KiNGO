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
  if (batch.cancelled) return `测速已取消，已完成 ${batch.results.length} 个节点`;
  if (tcpResultMayBeIntercepted) {
    return `TCP 端口检查完成：${succeeded}/${batch.results.length}。大量结果为 1-2 ms，可能被本机其他代理或 TUN 接管，请关闭后重测或使用“真实延迟”。`;
  }
  return `测速完成：${succeeded}/${batch.results.length} 个节点成功`;
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
      void importText(text, "剪贴板");
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
    if (result.imported) parts.push(`${result.imported} 个节点`);
    if (subscriptionCount) parts.push(`${subscriptionCount} 个订阅（${subscriptionNodes} 个节点）`);
    if (result.skipped) parts.push(`跳过 ${result.skipped} 个重复节点`);
    if (result.errors.length) parts.push(`${result.errors.length} 条未导入`);
    setNotice(`${source}导入完成：${parts.join("，") || "没有新增内容"}`);
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
        setDialogError("剪贴板中没有可导入的文本");
        return;
      }
      await importText(text, "剪贴板");
    } catch {
      importLinks();
      setDialogError("无法读取剪贴板，请在此粘贴节点或订阅内容");
    }
  }

  async function scanScreenQr() {
    setImportMenuOpen(false);
    await run("scan-screen", async () => {
      const result = await invoke<ImportResult>("scan_v2ray_qr_screen");
      importNotice(result, "屏幕二维码");
    });
  }

  async function importImage(file: File) {
    await run("scan-image", async () => {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const result = await invoke<ImportResult>("import_v2ray_qr_image", { bytes });
      importNotice(result, "二维码图片");
    });
  }

  async function importTextFile(file: File) {
    const text = await file.text();
    await importText(text, "文件");
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
      name: `订阅 ${subscriptions.length + 1}`,
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
        setNotice(`当前订阅已更新：${result.imported} 个节点`);
      } else {
        const result = await invoke<{
          updated: { imported: number }[];
          errors: string[];
        }>(
          "update_all_v2ray_subscriptions",
        );
        setNotice(
          `已更新 ${result.updated.length} 个订阅，共 ${result.updated.reduce((sum, item) => sum + item.imported, 0)} 个节点${result.errors.length ? `；${result.errors.length} 个失败：${result.errors.join("；")}` : ""}`,
        );
      }
    });
  }

  async function testSelected(mode: TestMode, explicitIds?: string[]) {
    if (busy?.startsWith("test-")) {
      setNotice("V2ray测速正在运行");
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
      setProgress({ completed: 0, total: started.total, nodeId: "", delay: null, speed: null, ipInfo: null, mode, message: "测速已开始" });
      if (started.total === 0) {
        setBusy(null);
        setProgress(null);
        setNotice("没有可测速的节点");
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
        ? `测速已取消，已完成 ${batch.results.length} 个节点`
        : tcpResultMayBeIntercepted
          ? `TCP 端口检查完成：${succeeded}/${batch.results.length}。大量结果为 1–2 ms，可能被本机其他代理或 TUN 接管，请关闭后重测或使用“真实延迟”。`
          : `测速完成：${succeeded}/${batch.results.length} 个节点成功`);
      setProgress(null);
    });
  }

  async function cancelTests() {
    await invoke("cancel_v2ray_tests");
    setNotice("正在取消测速…");
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
      setNotice({ top: "已移到顶部", bottom: "已移到底部", up: "已上移", down: "已下移" }[direction]);
    });
  }

  async function setActive(node: NodeItem) {
    setContextMenu(null);
    const switchingRunningNode = state.mode === "v2ray" && state.connected && !node.active;
    await run("active", async () => {
      await invoke("set_active_v2ray_node", { nodeId: node.id });
      setNotice(switchingRunningNode ? `已切换到 ${node.name}，V2ray 服务已重载` : `已选择 ${node.name}`);
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
      setNotice(`已复制 ${shares.length} 个节点分享链接`);
    });
  }

  async function exportNodes() {
    const ids = selected.size ? selectedIds() : visibleNodes.map((node) => node.id);
    await run("export", async () => {
      const path = await invoke<string>("export_v2ray_nodes", { nodeIds: ids });
      setNotice(`已导出到 ${path}`);
    });
  }

  async function removeDuplicates() {
    await run("dedupe", async () => {
      const count = await invoke<number>("remove_duplicate_v2ray_nodes");
      setNotice(count ? `已清理 ${count} 个重复节点` : "没有发现重复节点");
    });
  }

  async function duplicateNodes(node: NodeItem) {
    setContextMenu(null);
    const ids = selected.has(node.id) && selected.size > 1 ? selectedIds() : [node.id];
    await run("duplicate", async () => {
      for (const nodeId of ids) await invoke("duplicate_v2ray_node", { nodeId });
      setNotice(ids.length === 1 ? `已创建 ${node.name} 的副本` : `已创建 ${ids.length} 个节点副本`);
    });
  }

  async function moveNodeToGroup(node: NodeItem, subscriptionId: string | null) {
    setContextMenu(null);
    await run("move-group", async () => {
      await invoke("move_v2ray_node_group", { nodeId: node.id, subscriptionId });
      setNotice("节点分组已更新");
    });
  }

  async function sortNodes(by: string) {
    await run("sort", async () => {
      await invoke("sort_v2ray_nodes", { by });
      setNotice("节点排序已保存");
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
    setNotice("节点顺序已保存");
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
      setError("请先选择一个节点");
      return;
    }
    await run("connect", async () => {
      await invoke("start_v2ray_connection", { nodeId: target.id });
      setNotice(`已连接 ${target.name}`);
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
        if (!dialog.text.trim()) throw new Error("请粘贴至少一个节点分享链接");
        const result = await invoke<ImportResult>(
          "import_v2ray_nodes",
          { text: dialog.text },
        );
        importNotice(result, "文本");
      } else if (dialog.kind === "node") {
        const draft = dialog.draft;
        if (!draft.name.trim()) throw new Error("节点名称不能为空");
        if (!draft.host.trim()) throw new Error("服务器地址不能为空");
        const port = Number(draft.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("服务器端口必须在 1 到 65535 之间");
        if (["vmess", "vless", "trojan", "shadowsocks", "hysteria2", "anytls"].includes(draft.protocol) && !draft.password.trim()) {
          throw new Error(draft.protocol === "vless" || draft.protocol === "vmess" ? "用户 ID 不能为空" : "密码不能为空");
        }
        if (draft.security === "reality" && !draft.publicKey.trim()) throw new Error("Reality 公钥不能为空");
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
          setNotice("节点设置已保存");
        } else {
          await invoke("create_v2ray_node", { input });
          setNotice("节点已添加");
        }
      } else if (dialog.kind === "subscription") {
        if (!dialog.name.trim()) throw new Error("订阅名称不能为空");
        if (!/^https?:\/\//i.test(dialog.url.trim())) throw new Error("订阅地址必须以 http:// 或 https:// 开头");
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
            setNotice(`订阅已添加，导入 ${result.imported} 个节点`);
          } catch (value) {
            setError(`订阅已保存，但首次更新失败：${String(value)}`);
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
        setNotice("订阅设置已保存；更新订阅后应用新内容");
      } else if (dialog.kind === "delete-nodes") {
        await invoke("delete_v2ray_nodes", { nodeIds: dialog.nodeIds });
        setSelected(new Set());
        setNotice(`已删除 ${dialog.nodeIds.length} 个节点`);
      } else if (dialog.kind === "delete-subscription") {
        await invoke("delete_v2ray_subscription", { subscriptionId: dialog.subscription.id });
        setGroup("all");
        setNotice("订阅已删除");
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
      setNotice(`订阅“${subscription.name}”已更新：${result.imported} 个节点`);
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
      setNotice(subscription.enabled ? "已暂停该订阅的自动更新" : "已启用该订阅");
    });
  }

  const testingBusy = busy?.startsWith("test-") === true;
  const actionBusy = busy != null && !testingBusy;

  if (view === "subscriptions") {
    return (
      <div className="page v2ray-workspace v2ray-section-page">
        <section className="v2ray-section-heading">
          <div><h2>订阅分组</h2><p>管理订阅地址、过滤规则、User-Agent 与启用状态</p></div>
          <div><button className="primary-button" onClick={() => void addSubscription()}><PlusOutlined /> 添加订阅</button><button onClick={() => void updateSubscriptions()} disabled={!subscriptions.length || actionBusy}><ReloadOutlined /> 更新全部</button></div>
        </section>
        <Messages notice={notice} error={error ?? state.error} />
        <section className="v2ray-subscription-list">
          {subscriptions.map((subscription) => (
            <article key={subscription.id}>
              <div className="v2ray-subscription-main"><span className={subscription.enabled ? "subscription-dot enabled" : "subscription-dot"} /><div><b>{subscription.name}</b><p>{subscription.url}</p><small>{subscription.nodeCount} 个节点 · User-Agent: {subscription.userAgent || "v2rayN/7.12.5"}{subscription.filter ? ` · 过滤：${subscription.filter}` : ""}</small>{subscription.lastError && <em>{subscription.lastError}</em>}</div></div>
              <div className="v2ray-subscription-actions"><button onClick={() => void updateOneSubscription(subscription)} disabled={actionBusy}><ReloadOutlined /> 更新</button><button onClick={() => void editSubscription(subscription)}><EditOutlined /> 编辑</button><button onClick={() => void toggleSubscription(subscription)}>{subscription.enabled ? "停用" : "启用"}</button><button className="danger-button" onClick={() => void removeSubscription(subscription)}><DeleteOutlined /></button></div>
            </article>
          ))}
          {!subscriptions.length && <div className="v2ray-empty"><CloudDownloadOutlined /><b>还没有订阅分组</b><p>添加订阅后，节点会直接出现在“配置项”工作台。</p><button className="primary-button" onClick={() => void addSubscription()}><PlusOutlined /> 添加订阅</button></div>}
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
          <h2>{view === "help" ? "V2ray 模式帮助" : "关于 KiNGO"}</h2>
          {view === "help" ? <><p>在“配置项”导入或选择节点，双击节点可以打开完整配置编辑器；“订阅分组”负责订阅地址和更新策略。</p><ul><li>TCP 延迟只检查服务器端口是否可达。</li><li>真实延迟会启动对应核心，通过节点连续请求两次测试地址并查询出口 IP。</li><li>下载测速会消耗节点流量；一键多测会按设置的并发数执行真实延迟和下载测速。</li><li>UDP 测试通过 SOCKS5 UDP 关联验证节点的 UDP 转发能力。</li><li>重启服务会重新生成当前节点配置、重载核心并恢复系统代理。</li></ul></> : <><p>KiNGO 是一款简洁、安全的多核心网络连接工具。</p><p>V2ray 模式支持节点与订阅管理、连接测试、运行日志、系统代理以及 Xray / sing-box 核心。</p></>}
        </section>
      </div>
    );
  }

  return (
    <div className="page v2ray-workspace">
      <section className="v2ray-commandbar">
        <div className="v2ray-import-split" onClick={(event) => event.stopPropagation()}>
          <button onClick={() => void importClipboard()} disabled={actionBusy} title="读取剪贴板并直接导入（Ctrl+V）"><PlusOutlined /> 添加节点</button>
          <button className="v2ray-import-caret" onClick={() => setImportMenuOpen((open) => !open)} disabled={actionBusy} aria-label="更多导入方式"><DownOutlined /></button>
          {importMenuOpen && <div className="v2ray-import-menu">
            <button onClick={() => void importClipboard()}><CopyOutlined /><span><b>从剪贴板导入</b><small>Ctrl+V</small></span></button>
            <button onClick={() => void scanScreenQr()}><ScanOutlined /><span><b>扫描屏幕二维码</b><small>自动隐藏主窗口</small></span></button>
            <button onClick={() => { setImportMenuOpen(false); imageInputRef.current?.click(); }}><QrcodeOutlined /><span><b>扫描二维码图片</b><small>PNG、JPG、WebP</small></span></button>
            <button onClick={() => { setImportMenuOpen(false); textFileInputRef.current?.click(); }}><DownloadOutlined /><span><b>导入文本文件</b><small>分享链接或 Base64 订阅</small></span></button>
            <button onClick={() => importLinks()}><EditOutlined /><span><b>粘贴文本导入</b><small>查看并编辑原始内容</small></span></button>
            <button onClick={() => addManualNode()}><PlusOutlined /><span><b>手动添加节点</b><small>选择协议并填写参数</small></span></button>
          </div>}
          <input ref={imageInputRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/bmp" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importImage(file); }} />
          <input ref={textFileInputRef} hidden type="file" accept=".txt,.conf,.list,text/plain" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importTextFile(file); }} />
        </div>
        <button onClick={() => void testSelected("tcp")} disabled={!visibleNodes.length || testingBusy}><FieldTimeOutlined /> TCP 延迟</button>
        <button onClick={() => void testSelected("real")} disabled={!visibleNodes.length || testingBusy}><RocketOutlined /> 真实延迟</button>
        <button onClick={() => void testSelected("speed")} disabled={!visibleNodes.length || testingBusy}><DownloadOutlined /> 下载测速</button>
        <button onClick={() => void testSelected("mixed")} disabled={!nodes.length || testingBusy}><RocketOutlined /> 一键多测</button>
        <div className="v2ray-speedtest-more" onClick={(event) => event.stopPropagation()}>
          <button onClick={() => setSpeedTestMenuOpen((open) => !open)} disabled={!nodes.length || testingBusy}>更多测速 <DownOutlined /></button>
          {speedTestMenuOpen && <div className="v2ray-speedtest-menu">
            <button onClick={() => { setSpeedTestMenuOpen(false); void testSelected("udp"); }}><b>UDP 测试</b><small>验证节点 UDP 转发与往返延迟</small></button>
            <button onClick={() => { setSpeedTestMenuOpen(false); void testSelected("fast-real"); }}><b>快速真实延迟</b><small>并发测试全部节点并查询出口</small></button>
          </div>}
        </div>
        {testingBusy && <button className="danger-button" onClick={() => void cancelTests()}>取消测速</button>}
        <button onClick={() => void copyShares()} disabled={!visibleNodes.length || actionBusy}><CopyOutlined /> 复制分享</button>
        <button onClick={() => void exportNodes()} disabled={!visibleNodes.length || actionBusy}><DownloadOutlined /> 导出</button>
        {state.mode === "v2ray" && (state.connected || state.connecting) ? (
          <button className="danger-button" disabled={actionBusy} onClick={() => void run("disconnect", () => invoke("stop_v2ray_connection"))}><DisconnectOutlined /> 关闭</button>
        ) : (
          <button className="primary-button" disabled={!nodes.length || actionBusy} onClick={() => void connectNode()}><RocketOutlined /> 启动服务</button>
        )}
      </section>
      <section className="v2ray-group-tabs">
        <button className={group === "all" ? "active" : ""} onClick={() => { setGroup("all"); setSelected(new Set()); }}>所有 <em>{nodes.length}</em></button>
        <button className={group === "manual" ? "active" : ""} onClick={() => { setGroup("manual"); setSelected(new Set()); }}>手动导入</button>
          {subscriptions.map((subscription) => (
            <div className="v2ray-sub-row" key={subscription.id}>
              <button className={group === subscription.id ? "active" : ""} onClick={() => { setGroup(subscription.id); setSelected(new Set()); }} title={subscription.lastError ?? subscription.url}>
                <span>{subscription.name}</span><em>{subscription.nodeCount}</em>
              </button>
              <button className="v2ray-sub-delete" title="编辑订阅" onClick={() => void editSubscription(subscription)}><EditOutlined /></button>
              <button className="v2ray-sub-delete" title="删除订阅" onClick={() => void removeSubscription(subscription)}><DeleteOutlined /></button>
            </div>
          ))}
      </section>
      <div className="v2ray-layout">
        <section className="v2ray-nodes-panel">
          <div className="v2ray-toolbar">
            <div className="v2ray-filter-controls">
              <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="筛选名称、协议、地址或核心" />
              <select value={resultFilter} onChange={(event) => setResultFilter(event.target.value as ResultFilter)} title="测试结果筛选">
                <option value="all">全部结果</option><option value="available">可用</option><option value="failed">失败</option><option value="untested">未测试</option>
              </select>
              <select defaultValue="" onChange={(event) => { if (event.target.value) void sortNodes(event.target.value); event.target.value = ""; }} title="排序">
                <option value="">排序</option><option value="name">按名称</option><option value="protocol">按协议</option><option value="delay">按延迟</option><option value="subscription">按分组</option>
              </select>
              <select value={doubleClickAction} onChange={(event) => { const value = event.target.value as "edit" | "activate"; setDoubleClickAction(value); localStorage.setItem("v2ray-double-click", value); }} title="双击节点时执行">
                <option value="edit">双击编辑</option><option value="activate">双击选择</option>
              </select>
            </div>
            <div>
              <button onClick={() => void moveSelected("up")} disabled={!selected.size || actionBusy} title="上移"><ArrowUpOutlined /></button>
              <button onClick={() => void moveSelected("down")} disabled={!selected.size || actionBusy} title="下移"><ArrowDownOutlined /></button>
              <button onClick={() => void moveSelected("top")} disabled={!selected.size || actionBusy} title="移到顶部"><VerticalAlignTopOutlined /></button>
              <button onClick={() => void moveSelected("bottom")} disabled={!selected.size || actionBusy} title="移到底部"><VerticalAlignBottomOutlined /></button>
              <button onClick={() => void removeDuplicates()} disabled={!nodes.length || actionBusy} title="清理重复节点">去重</button>
              <button className="danger-button" onClick={() => { const ids = nodes.filter((node) => node.lastTestedAt != null && node.delay == null).map((node) => node.id); if (ids.length) setDialog({ kind: "delete-nodes", nodeIds: ids }); else setNotice("没有测试失败的节点"); }} disabled={actionBusy} title="删除测试失败的节点">删失效</button>
              <button className="danger-button" onClick={() => void removeSelected()} disabled={!selected.size || actionBusy}><DeleteOutlined /></button>
            </div>
          </div>
          {progress && <div className="v2ray-test-progress"><LoadingOutlined spin /> 测速进度 {progress.completed}/{progress.total} · {progress.message}{progress.speed ? ` · ${speedText(progress.speed)}` : ""}</div>}
          <Messages notice={notice} error={error ?? state.error} />
          <div className="v2ray-table" tabIndex={0} onKeyDown={handleTableKeyDown}>
            <div className="v2ray-table-head"><span><input type="checkbox" checked={visibleNodes.length > 0 && visibleNodes.every((item) => selected.has(item.id))} onChange={(event) => setSelected(event.target.checked ? new Set(visibleNodes.map((item) => item.id)) : new Set())} /></span><span>类型</span><span>别名</span><span>延迟</span><span>速度</span><span>地址</span><span>出口</span><span>核心</span><span>操作</span></div>
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
                <span className={node.delay == null ? "node-delay muted" : "node-delay"}>{node.delay == null ? "未测" : `${node.delay} ms`}</span>
                <span className={node.speed == null ? "node-speed muted" : "node-speed"}>{speedText(node.speed)}</span>
                <span className="node-address">{node.host}:{node.port}</span>
                <span className="node-ip-info" title={node.ipInfo ?? ""}>{node.ipInfo ?? "-"}</span>
                <span>{node.coreId}</span>
                <span className="node-actions"><button title="编辑节点" onClick={() => void editNode(node)}><EditOutlined /></button><button title="分享节点" onClick={() => void showShare(node)}><QrcodeOutlined /></button><button title="设为活动节点" onClick={() => void setActive(node)}>{node.active ? "已选择" : "选择"}</button><button title="连接" onClick={() => void connectNode(node)}><RocketOutlined /></button></span>
              </div>
            ))}
            {!visibleNodes.length && <div className="v2ray-empty"><NodeIndexOutlined /><b>当前分组没有节点</b><p>复制节点或订阅链接后，点击按钮即可直接导入。</p><button className="primary-button" onClick={() => void importClipboard()}><PlusOutlined /> 从剪贴板导入</button></div>}
          </div>
        </section>
      </div>
      <section className="v2ray-log-panel">
        <header><b>运行日志</b><span>{state.mode === "v2ray" ? `${state.coreId ?? "-"} · ${state.stage}` : "V2ray 服务未启动"}</span></header>
        <div className="v2ray-log-lines">
          {logs.length ? logs.slice(-8).map((item, index) => <p key={`${item.at}-${index}`} className={`level-${item.level}`}><time>{item.at}</time> {item.message}</p>) : <p className="muted">暂无运行日志。选择节点并点击“启动服务”后在这里查看核心输出。</p>}
        </div>
      </section>
      <footer className="v2ray-statusbar">
        <span>本地 SOCKS：{runtimeSettings.allowLan ? "0.0.0.0" : "127.0.0.1"}:{runtimeSettings.localPort}</span>
        <span>系统代理：{!runtimeSettings.systemProxy ? "不接管" : state.mode === "v2ray" && state.connected ? "已开启" : "未开启"}</span>
        <span>当前节点：{state.mode === "v2ray" ? state.displayName ?? "-" : nodes.find((item) => item.active)?.name ?? "-"}</span>
        <span>出口：{state.mode === "v2ray" ? state.exitIp ?? "-" : "-"}</span>
      </footer>
      <V2rayDialog dialog={dialog} error={dialogError} busy={busy === "dialog"} onChange={setDialog} onCancel={() => setDialog(null)} onSubmit={() => void submitDialog()} />
      {contextMenu && <div className="v2ray-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
        <button onClick={() => editNode(contextMenu.node)}><EditOutlined /> 编辑节点</button>
        <button onClick={() => void setActive(contextMenu.node)}>设为活动节点</button>
        <button onClick={() => void testSelected("tcp", [contextMenu.node.id])}><FieldTimeOutlined /> 测试延迟</button>
        <button onClick={() => void testSelected("real", [contextMenu.node.id])}><RocketOutlined /> 真实延迟</button>
        <button onClick={() => void testSelected("speed", [contextMenu.node.id])}><DownloadOutlined /> 下载测速</button>
        <button onClick={() => void testSelected("udp", [contextMenu.node.id])}>UDP 测试</button>
        <button onClick={() => void showShare(contextMenu.node)}><QrcodeOutlined /> 分享 / 二维码</button>
        <button onClick={() => void duplicateNodes(contextMenu.node)}><CopyOutlined /> {selected.has(contextMenu.node.id) && selected.size > 1 ? `创建 ${selected.size} 个副本` : "创建副本"}</button>
        <label>移动到分组<select value={contextMenu.node.subscriptionId ?? "manual"} onChange={(event) => void moveNodeToGroup(contextMenu.node, event.target.value === "manual" ? null : event.target.value)}><option value="manual">手动导入</option>{subscriptions.map((subscription) => <option value={subscription.id} key={subscription.id}>{subscription.name}</option>)}</select></label>
        <button className="danger-button" onClick={() => { setDialog({ kind: "delete-nodes", nodeIds: [contextMenu.node.id] }); setContextMenu(null); }}><DeleteOutlined /> 删除节点</button>
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
    ? "导入节点"
    : dialog.kind === "node"
      ? dialog.nodeId ? "编辑节点" : "手动添加节点"
      : dialog.kind === "subscription"
        ? dialog.mode === "add" ? "添加订阅" : "编辑订阅"
        : dialog.kind === "share"
          ? "分享节点"
          : dialog.kind === "delete-nodes" ? "删除节点" : "删除订阅";
  return (
    <div className="v2ray-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <form className={`v2ray-modal${dialog.kind === "node" ? " node-editor" : ""}`} role="dialog" aria-modal="true" aria-label={title} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <header><div><b>{title}</b><small>{dialog.kind === "import" ? "支持分享链接、订阅地址与 Base64 内容" : dialog.kind === "share" ? dialog.share.name : destructive ? "此操作无法撤销" : "确认信息后保存"}</small></div><button type="button" aria-label="关闭" disabled={busy} onClick={onCancel}>×</button></header>
        <div className="v2ray-modal-body">
          {dialog.kind === "import" && <label><span>节点或订阅内容</span><textarea autoFocus rows={9} value={dialog.text} onChange={(event) => onChange({ ...dialog, text: event.target.value })} placeholder={"vless://...\nvmess://...\nhttps://example.com/subscription"} /></label>}
          {dialog.kind === "node" && <NodeEditor creating={!dialog.nodeId} draft={dialog.draft} onChange={(draft) => onChange({ ...dialog, draft })} />}
          {dialog.kind === "subscription" && <><label><span>订阅名称</span><input autoFocus value={dialog.name} onChange={(event) => onChange({ ...dialog, name: event.target.value })} /></label><label><span>订阅地址</span><input value={dialog.url} onChange={(event) => onChange({ ...dialog, url: event.target.value })} placeholder="https://example.com/subscription" /></label><div className="v2ray-modal-grid"><label><span>User-Agent</span><input value={dialog.userAgent} onChange={(event) => onChange({ ...dialog, userAgent: event.target.value })} /></label><label><span>节点名称过滤</span><input value={dialog.filter} onChange={(event) => onChange({ ...dialog, filter: event.target.value })} placeholder="留空表示不过滤" /></label></div>{dialog.mode === "edit" && <label className="v2ray-check"><input type="checkbox" checked={dialog.enabled} onChange={(event) => onChange({ ...dialog, enabled: event.target.checked })} /><span>启用订阅更新</span></label>}</>}
          {dialog.kind === "delete-nodes" && <p className="v2ray-confirm-text">确定删除选中的 <b>{dialog.nodeIds.length}</b> 个节点吗？</p>}
          {dialog.kind === "delete-subscription" && <p className="v2ray-confirm-text">确定删除订阅“<b>{dialog.subscription.name}</b>”及其 {dialog.subscription.nodeCount} 个节点吗？</p>}
          {dialog.kind === "share" && <div className="v2ray-share-dialog">
            {dialog.qrSvg && <div className="v2ray-qr" dangerouslySetInnerHTML={{ __html: dialog.qrSvg }} />}
            <label><span>分享链接</span><textarea rows={4} readOnly value={dialog.share.link} /></label>
          </div>}
          {error && <div className="v2ray-modal-error">{error}</div>}
        </div>
        <footer>{dialog.kind === "share" ? <><button type="button" onClick={onCancel}>关闭</button><button type="button" className="primary-button" onClick={() => void navigator.clipboard.writeText(dialog.share.link)}><CopyOutlined /> 复制链接</button></> : <><button type="button" disabled={busy} onClick={onCancel}>取消</button><button type="submit" disabled={busy} className={destructive ? "danger-button" : "primary-button"}>{busy ? <LoadingOutlined spin /> : null} {destructive ? "确认删除" : dialog.kind === "import" ? "开始导入" : "保存"}</button></>}</footer>
      </form>
    </div>
  );
}

function NodeEditor({ draft, onChange, creating = false }: { draft: NodeEditorDraft; onChange: (draft: NodeEditorDraft) => void; creating?: boolean }) {
  const set = <K extends keyof NodeEditorDraft>(key: K, value: NodeEditorDraft[K]) => onChange({ ...draft, [key]: value });
  const credentialLabel = draft.protocol === "vmess" || draft.protocol === "vless" ? "用户 ID" : "密码";
  const hasTransport = ["vmess", "vless", "trojan"].includes(draft.protocol);
  const hasTls = ["vmess", "vless", "trojan", "hysteria2", "tuic", "anytls"].includes(draft.protocol);
  const requiresSingBox = ["hysteria2", "tuic", "anytls"].includes(draft.protocol);
  return (
    <div className="v2ray-node-editor">
      <section>
        <h3>配置项</h3>
        <div className="v2ray-modal-grid three">
          <label><span>协议类型</span>{creating ? <select value={draft.protocol} onChange={(event) => onChange({ ...emptyNodeDraft(event.target.value), name: draft.name, host: draft.host, port: draft.port })}><option value="vless">VLESS</option><option value="vmess">VMess</option><option value="trojan">Trojan</option><option value="shadowsocks">Shadowsocks</option><option value="socks">SOCKS</option><option value="http">HTTP</option><option value="hysteria2">Hysteria2</option><option value="tuic">TUIC</option><option value="anytls">AnyTLS</option></select> : <input value={draft.protocol.toUpperCase()} readOnly />}</label>
          <label><span>运行核心</span><select value={draft.coreId} onChange={(event) => set("coreId", event.target.value)}><option value="xray" disabled={requiresSingBox}>Xray</option><option value="sing-box">sing-box</option></select></label>
          <label><span>别名（remarks）</span><input autoFocus value={draft.name} onChange={(event) => set("name", event.target.value)} /></label>
          <label className="span-two"><span>地址（address）</span><input value={draft.host} onChange={(event) => set("host", event.target.value)} /></label>
          <label><span>端口（port）</span><input type="number" min="1" max="65535" value={draft.port} onChange={(event) => set("port", event.target.value)} /></label>
        </div>
      </section>

      <section>
        <h3>协议认证</h3>
        <div className="v2ray-modal-grid">
          {(draft.protocol === "socks" || draft.protocol === "http" || draft.protocol === "tuic") && <label><span>{draft.protocol === "tuic" ? "用户 ID（UUID）" : "用户名"}</span><div className="v2ray-input-action"><input value={draft.username} onChange={(event) => set("username", event.target.value)} />{draft.protocol === "tuic" && <button type="button" onClick={() => set("username", crypto.randomUUID())}>生成</button>}</div></label>}
          {draft.protocol === "shadowsocks" && <label><span>加密方式（method）</span><input value={draft.method} onChange={(event) => set("method", event.target.value)} /></label>}
          <label><span>{credentialLabel}</span><div className="v2ray-input-action"><input value={draft.password} onChange={(event) => set("password", event.target.value)} />{(draft.protocol === "vmess" || draft.protocol === "vless") && <button type="button" onClick={() => set("password", crypto.randomUUID())}>生成</button>}</div></label>
          {draft.protocol === "vmess" && <><label><span>Alter ID</span><input type="number" min="0" value={draft.alterId} onChange={(event) => set("alterId", event.target.value)} /></label><label><span>加密方式（encryption）</span><input value={draft.encryption} onChange={(event) => set("encryption", event.target.value)} /></label></>}
          {draft.protocol === "vless" && <><label><span>流控（flow）</span><select value={draft.flow} onChange={(event) => set("flow", event.target.value)}><option value="">无</option><option value="xtls-rprx-vision">xtls-rprx-vision</option></select></label><label><span>加密方式（encryption）</span><input value={draft.encryption} onChange={(event) => set("encryption", event.target.value)} /></label></>}
        </div>
        {["vmess", "vless", "trojan", "shadowsocks"].includes(draft.protocol) && <label className="v2ray-check"><input type="checkbox" checked={draft.muxEnabled} onChange={(event) => set("muxEnabled", event.target.checked)} /><span>开启 Mux 多路复用</span></label>}
      </section>

      {hasTransport && <section>
        <h3>底层传输方式（transport）</h3>
        <div className="v2ray-modal-grid">
          <label><span>传输协议（network）</span><select value={draft.network} onChange={(event) => set("network", event.target.value)}><option value="tcp">tcp</option><option value="ws">ws</option><option value="grpc">grpc</option><option value="httpupgrade">httpupgrade</option><option value="xhttp">xhttp</option></select></label>
          {draft.network !== "tcp" && <label><span>Host</span><input value={draft.transportHost} onChange={(event) => set("transportHost", event.target.value)} /></label>}
          {["ws", "httpupgrade", "xhttp"].includes(draft.network) && <label><span>路径（path）</span><input value={draft.path} onChange={(event) => set("path", event.target.value)} /></label>}
          {draft.network === "grpc" && <label><span>Service Name</span><input value={draft.serviceName} onChange={(event) => set("serviceName", event.target.value)} /></label>}
          <label><span>Finalmask</span><input value={draft.finalmask} onChange={(event) => set("finalmask", event.target.value)} /></label>
        </div>
      </section>}

      {hasTls && <section>
        <h3>传输层安全（TLS）</h3>
        <div className="v2ray-modal-grid">
          <label><span>安全类型</span><select value={draft.security} onChange={(event) => set("security", event.target.value)}><option value="none">none</option><option value="tls">tls</option>{(draft.protocol === "vless" || draft.protocol === "trojan") && <option value="reality">reality</option>}</select></label>
          <label><span>SNI</span><input value={draft.sni} onChange={(event) => set("sni", event.target.value)} /></label>
          <label><span>Fingerprint</span><select value={draft.fingerprint} onChange={(event) => set("fingerprint", event.target.value)}><option value="chrome">chrome</option><option value="firefox">firefox</option><option value="safari">safari</option><option value="edge">edge</option><option value="random">random</option><option value="">留空</option></select></label>
          <label><span>ALPN</span><input value={draft.alpn} onChange={(event) => set("alpn", event.target.value)} placeholder="h2,http/1.1" /></label>
          {draft.security === "reality" && <><label><span>Public Key</span><input value={draft.publicKey} onChange={(event) => set("publicKey", event.target.value)} /></label><label><span>Short ID</span><input value={draft.shortId} onChange={(event) => set("shortId", event.target.value)} /></label><label><span>Spider X</span><input value={draft.spiderX} onChange={(event) => set("spiderX", event.target.value)} /></label></>}
          <label><span>ECH Config List</span><input value={draft.echConfigList} onChange={(event) => set("echConfigList", event.target.value)} /></label>
          <label><span>Verify Peer Cert By Name</span><input value={draft.verifyPeerCertByName} onChange={(event) => set("verifyPeerCertByName", event.target.value)} /></label>
          <label><span>固定证书 SHA-256</span><input value={draft.certSha} onChange={(event) => set("certSha", event.target.value)} /></label>
          <label className="span-two"><span>固定证书（PEM）</span><textarea rows={4} value={draft.cert} onChange={(event) => set("cert", event.target.value)} placeholder="-----BEGIN CERTIFICATE-----" /></label>
        </div>
        <label className="v2ray-check"><input type="checkbox" checked={draft.allowInsecure} onChange={(event) => set("allowInsecure", event.target.checked)} /><span>跳过证书验证（allowInsecure）</span></label>
      </section>}
    </div>
  );
}

function Messages({ notice, error }: { notice?: string | null; error?: string | null }) {
  return <>{notice && <div className="v2ray-message success">{notice}</div>}{error && <div className="v2ray-message error">{error}</div>}</>;
}
