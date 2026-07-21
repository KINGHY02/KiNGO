import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  ApartmentOutlined,
  ApiOutlined,
  CheckCircleOutlined,
  CloudDownloadOutlined,
  CloudOutlined,
  CodeOutlined,
  CopyOutlined,
  DeleteOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  LockOutlined,
  PlusOutlined,
  ProfileOutlined,
  ReloadOutlined,
  RocketOutlined,
  SearchOutlined,
  SwapOutlined,
  ThunderboltOutlined,
  WifiOutlined,
} from "@ant-design/icons";
import "./ClashWorkspace.css";

export type ClashPage =
  | "home"
  | "proxy"
  | "subscriptions"
  | "connections"
  | "rules"
  | "logs"
  | "tests"
  | "settings";

type ClashState = {
  mode: string;
  connected: boolean;
  connecting: boolean;
  coreId: string | null;
  displayName: string | null;
  latency: number | null;
  country: string | null;
  downloadBps: number;
  uploadBps: number;
  downloadTotal: number;
  uploadTotal: number;
  tunEnabled: boolean;
  systemProxyEnabled: boolean;
};

type ClashLog = { at: string; level: string; message: string };
type ClashProxyNode = { name: string; kind: string; delay: number | null };
type ClashProxyGroup = {
  name: string;
  kind: string;
  now: string | null;
  nodes: ClashProxyNode[];
};
type ClashProxyProvider = {
  name: string;
  kind: string;
  vehicleType: string;
  updatedAt: string | null;
  nodeCount: number;
};
type ProxyGroupView = {
  open: boolean;
  filter: string;
  sort: "default" | "name" | "delay";
};
export type ClashConnection = {
  id: string;
  startedAt: string;
  host: string;
  network: string;
  connectionType: string;
  sourceIp: string;
  sourcePort: number;
  destinationIp: string;
  destinationPort: number;
  process: string;
  processPath: string;
  rule: string;
  rulePayload: string;
  chains: string[];
  download: number;
  upload: number;
};
type ConnectionView = ClashConnection & {
  downloadRate: number;
  uploadRate: number;
  closedAt?: number;
};
export type ClashRealtimeChannels = {
  traffic: boolean;
  connections: boolean;
  logs: boolean;
};
type ClashRule = { kind: string; payload: string; proxy: string };
type ClashSettings = {
  mode: string;
  clashCore: string;
  allowLan: boolean;
  ipv6: boolean;
  unifiedDelay: boolean;
  systemProxy: boolean;
  tunEnabled: boolean;
};
type CoreVersionInfo = {
  coreId: string;
  name: string;
  currentVersion: string | null;
  latestVersion: string | null;
  outdated: boolean;
  source: string;
  available: boolean;
  updateSupported: boolean;
  assetName: string | null;
  assetSize: number | null;
  error: string | null;
};
type ServiceResult = { status: number; latency: number };
type Profile = {
  id: string;
  name: string;
  url: string;
  source: "url" | "local";
  description: string;
  userAgent: string;
  timeoutSeconds: number;
  proxyMode: "system" | "direct" | "clash";
  acceptInvalidCerts: boolean;
  allowAutoUpdate: boolean;
  updateInterval: number | null;
  nextUpdateAt: number | null;
  upload: number;
  download: number;
  total: number;
  expire: number;
  homeUrl: string;
  fileName: string;
  updatedAt: number | null;
  active: boolean;
  lastError: string | null;
};
type ClashBatchResult = {
  succeeded: string[];
  failed: { profileId: string; error: string }[];
};
type ConfigDialog = {
  mode: "import" | "source" | "runtime";
  profile?: Profile;
};
type NewProfileForm = {
  type: "remote" | "local";
  name: string;
  description: string;
  url: string;
  content: string;
  fileName: string;
  userAgent: string;
  timeoutSeconds: number;
  proxyMode: "system" | "direct" | "clash";
  acceptInvalidCerts: boolean;
  allowAutoUpdate: boolean;
  updateInterval: string;
  basicRouting: boolean;
};

const EMPTY_NEW_PROFILE: NewProfileForm = {
  type: "remote",
  name: "",
  description: "",
  url: "",
  content: "",
  fileName: "",
  userAgent: "",
  timeoutSeconds: 20,
  proxyMode: "system",
  acceptInvalidCerts: false,
  allowAutoUpdate: true,
  updateInterval: "",
  basicRouting: true,
};

const SERVICE_TESTS = [
  ["哔哩哔哩", "https://api.bilibili.com/x/web-interface/zone"],
  ["ChatGPT Web", "https://chatgpt.com/"],
  ["Claude", "https://claude.ai/"],
  ["Disney+", "https://www.disneyplus.com/"],
  ["Gemini", "https://gemini.google.com/"],
  ["Netflix", "https://www.netflix.com/title/80018499"],
  ["Prime Video", "https://www.primevideo.com/"],
  ["Spotify", "https://open.spotify.com/"],
  ["TikTok", "https://www.tiktok.com/"],
  ["YouTube Premium", "https://www.youtube.com/premium"],
] as const;

function formatBytes(value: number, rate = false) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = Math.max(0, value);
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount >= 100 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}${rate ? "/s" : ""}`;
}

function ClashEmpty({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="clash-empty">
      <span>{icon}</span>
      <b>{title}</b>
      <p>{text}</p>
    </div>
  );
}

export function ClashWorkspace({
  page,
  state,
  logs,
  onPage,
  connections,
  realtime,
}: {
  page: ClashPage;
  state: ClashState;
  logs: ClashLog[];
  onPage: (page: ClashPage) => void;
  connections: ClashConnection[];
  realtime: ClashRealtimeChannels;
}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [url, setUrl] = useState("");
  const [quickBasicRouting, setQuickBasicRouting] = useState(true);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profileAction, setProfileAction] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Profile | null>(null);
  const [pendingBatchDelete, setPendingBatchDelete] = useState(false);
  const [selectedProfiles, setSelectedProfiles] = useState<Set<string>>(
    new Set(),
  );
  const [configDialog, setConfigDialog] = useState<ConfigDialog | null>(null);
  const [configName, setConfigName] = useState("");
  const [configContent, setConfigContent] = useState("");
  const [configLoading, setConfigLoading] = useState(false);
  const [newProfileOpen, setNewProfileOpen] = useState(false);
  const [newProfile, setNewProfile] =
    useState<NewProfileForm>(EMPTY_NEW_PROFILE);
  const [dragActive, setDragActive] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);
  const [proxyGroups, setProxyGroups] = useState<ClashProxyGroup[]>([]);
  const [proxyLoading, setProxyLoading] = useState(false);
  const [proxyActions, setProxyActions] = useState<Record<string, boolean>>({});
  const [proxyMessage, setProxyMessage] = useState<string | null>(null);
  const [proxyFilter, setProxyFilter] = useState("");
  const [proxySort, setProxySort] = useState<"default" | "name" | "delay">(
    "default",
  );
  const [proxyProviders, setProxyProviders] = useState<ClashProxyProvider[]>(
    [],
  );
  const [proxyGroupViews, setProxyGroupViews] = useState<
    Record<string, ProxyGroupView>
  >(() => {
    try {
      return JSON.parse(
        localStorage.getItem("kingo-clash-proxy-group-views") ?? "{}",
      );
    } catch {
      return {};
    }
  });
  const [filter, setFilter] = useState("");
  const [proxyMode, setProxyMode] = useState("rule");
  const [clashCore, setClashCore] = useState("mihomo");
  const [clashCoreVersions, setClashCoreVersions] = useState<CoreVersionInfo[]>(
    [],
  );
  const [coreMessage, setCoreMessage] = useState<string | null>(null);
  const [allowLan, setAllowLan] = useState(false);
  const [ipv6, setIpv6] = useState(false);
  const [unifiedDelay, setUnifiedDelay] = useState(true);
  const [settingsAction, setSettingsAction] = useState<string | null>(null);
  const [rules, setRules] = useState<ClashRule[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [logStart, setLogStart] = useState(0);
  const [serviceResults, setServiceResults] = useState<
    Record<string, ServiceResult | { error: string }>
  >({});
  const [testActions, setTestActions] = useState<Record<string, boolean>>({});
  const [trafficHistory, setTrafficHistory] = useState<{
    down: number[];
    up: number[];
  }>({ down: [], up: [] });
  const [connectionRates, setConnectionRates] = useState<
    Record<string, { downloadRate: number; uploadRate: number }>
  >({});
  const [closedConnections, setClosedConnections] = useState<ConnectionView[]>(
    [],
  );
  const [connectionTab, setConnectionTab] = useState<"active" | "closed">(
    "active",
  );
  const [connectionSort, setConnectionSort] = useState<
    "downloadRate" | "uploadRate" | "traffic" | "host"
  >("downloadRate");
  const [connectionDetail, setConnectionDetail] =
    useState<ConnectionView | null>(null);
  const previousConnections = useRef<{
    at: number;
    items: Map<string, ClashConnection>;
  }>({ at: Date.now(), items: new Map() });

  useEffect(() => {
    if (!profileMessage) return;
    const timer = window.setTimeout(
      () => setProfileMessage(null),
      profileMessage.kind === "success" ? 4000 : 10000,
    );
    return () => window.clearTimeout(timer);
  }, [profileMessage]);

  useEffect(() => {
    if (!proxyMessage) return;
    const timer = window.setTimeout(() => setProxyMessage(null), 10000);
    return () => window.clearTimeout(timer);
  }, [proxyMessage]);

  useEffect(() => {
    localStorage.setItem(
      "kingo-clash-proxy-group-views",
      JSON.stringify(proxyGroupViews),
    );
  }, [proxyGroupViews]);

  async function loadProfiles() {
    try {
      setProfiles(await invoke<Profile[]>("list_clash_profiles"));
    } catch (error) {
      setProfileMessage({ kind: "error", text: String(error) });
    } finally {
      setProfilesLoading(false);
    }
  }

  useEffect(() => {
    void loadProfiles();
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    void listen("clash-profiles-changed", () => void loadProfiles()).then(
      (cleanup) => {
        unlisten = cleanup;
      },
    );
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (page !== "subscriptions") return;
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setDragActive(true);
          return;
        }
        if (event.payload.type === "leave") {
          setDragActive(false);
          return;
        }
        setDragActive(false);
        const paths = event.payload.paths.filter((path) =>
          /\.ya?ml$/i.test(path),
        );
        if (!paths.length) {
          setProfileMessage({
            kind: "error",
            text: "只能拖入 .yaml 或 .yml 配置文件",
          });
          return;
        }
        setProfileAction("file-import");
        void (async () => {
          const failures: string[] = [];
          for (const path of paths) {
            try {
              await invoke("import_clash_profile_file", { path });
            } catch (error) {
              failures.push(String(error));
            }
          }
          await loadProfiles();
          setProfileMessage(
            failures.length
              ? {
                  kind: "error",
                  text: `已导入 ${paths.length - failures.length} 项，${failures.length} 项失败：${failures[0]}`,
                }
              : {
                  kind: "success",
                  text: `已导入 ${paths.length} 个本地 YAML 配置`,
                },
          );
          setProfileAction(null);
        })();
      })
      .then((cleanup) => {
        unlisten = cleanup;
      });
    return () => unlisten?.();
  }, [page]);

  useEffect(() => {
    void invoke<ClashSettings>("get_clash_settings")
      .then((settings) => {
        setProxyMode(settings.mode);
        setClashCore(settings.clashCore);
        setAllowLan(settings.allowLan);
        setIpv6(settings.ipv6);
        setUnifiedDelay(settings.unifiedDelay);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (page !== "settings") return;
    void refreshClashCoreVersions(false);
  }, [page]);

  useEffect(() => {
    setTrafficHistory((current) => ({
      down: [...current.down, state.downloadBps].slice(-40),
      up: [...current.up, state.uploadBps].slice(-40),
    }));
  }, [state.downloadBps, state.uploadBps]);

  useEffect(() => {
    const now = Date.now();
    const previous = previousConnections.current;
    const elapsed = Math.max(0.25, (now - previous.at) / 1000);
    const nextRates: Record<
      string,
      { downloadRate: number; uploadRate: number }
    > = {};
    for (const connection of connections) {
      const last = previous.items.get(connection.id);
      nextRates[connection.id] = {
        downloadRate: last
          ? Math.max(0, connection.download - last.download) / elapsed
          : 0,
        uploadRate: last
          ? Math.max(0, connection.upload - last.upload) / elapsed
          : 0,
      };
    }
    const activeIds = new Set(connections.map((connection) => connection.id));
    const justClosed = [...previous.items.values()]
      .filter((connection) => !activeIds.has(connection.id))
      .map((connection) => ({
        ...connection,
        ...(connectionRates[connection.id] ?? {
          downloadRate: 0,
          uploadRate: 0,
        }),
        closedAt: now,
      }));
    if (justClosed.length) {
      setClosedConnections((current) => {
        const closedIds = new Set(justClosed.map((item) => item.id));
        return [
          ...justClosed,
          ...current.filter((item) => !closedIds.has(item.id)),
        ].slice(0, 100);
      });
    }
    setConnectionRates(nextRates);
    previousConnections.current = {
      at: now,
      items: new Map(
        connections.map((connection) => [connection.id, connection]),
      ),
    };
  }, [connections]);

  async function loadProxyGroups() {
    if (!(
      state.connected &&
      state.mode === "clash" &&
      state.coreId === "mihomo"
    )) {
      setProxyGroups([]);
      setProxyProviders([]);
      return;
    }
    setProxyLoading(true);
    const [groups, providers] = await Promise.allSettled([
      invoke<ClashProxyGroup[]>("list_clash_proxy_groups"),
      invoke<ClashProxyProvider[]>("list_clash_proxy_providers"),
    ]);
    if (groups.status === "fulfilled") setProxyGroups(groups.value);
    else setProxyGroups([]);
    if (providers.status === "fulfilled") setProxyProviders(providers.value);
    else setProxyProviders([]);
    const errors = [groups, providers]
      .filter((result) => result.status === "rejected")
      .map((result) => String((result as PromiseRejectedResult).reason));
    setProxyMessage(errors.length ? errors.join("；") : null);
    setProxyLoading(false);
  }

  useEffect(() => {
    if (page === "proxy") void loadProxyGroups();
  }, [page, state.connected, state.mode, state.coreId]);

  async function loadRules(quiet = false) {
    if (!state.connected) return;
    if (!quiet) setDataLoading(true);
    try {
      setRules(await invoke<ClashRule[]>("list_clash_rules"));
      setProxyMessage(null);
    } catch (error) {
      setProxyMessage(String(error));
    } finally {
      if (!quiet) setDataLoading(false);
    }
  }

  useEffect(() => {
    if (page !== "rules") return;
    void loadRules();
    if (!state.connected) return;
    const interval = window.setInterval(() => void loadRules(true), 30000);
    return () => window.clearInterval(interval);
  }, [page, state.connected]);

  const clashLogs = useMemo(
    () =>
      logs
        .slice(logStart)
        .filter((entry) => /clash|mihomo|订阅|代理组/i.test(entry.message)),
    [logs, logStart],
  );
  const visibleProxyGroups = useMemo(
    () =>
      proxyGroups
        .map((group) => {
          const keyword = proxyFilter.trim().toLocaleLowerCase();
          const nodes = group.nodes.filter(
            (node) =>
              !keyword || node.name.toLocaleLowerCase().includes(keyword),
          );
          if (proxySort === "name")
            nodes.sort((left, right) =>
              left.name.localeCompare(right.name, "zh-CN"),
            );
          if (proxySort === "delay")
            nodes.sort(
              (left, right) =>
                (left.delay ?? Number.MAX_SAFE_INTEGER) -
                (right.delay ?? Number.MAX_SAFE_INTEGER),
            );
          return { ...group, nodes };
        })
        .filter((group) => !proxyFilter.trim() || group.nodes.length > 0),
    [proxyGroups, proxyFilter, proxySort],
  );

  function groupView(name: string): ProxyGroupView {
    return proxyGroupViews[name] ?? { open: true, filter: "", sort: "default" };
  }

  function updateGroupView(name: string, change: Partial<ProxyGroupView>) {
    setProxyGroupViews((current) => ({
      ...current,
      [name]: {
        ...(current[name] ?? { open: true, filter: "", sort: "default" }),
        ...change,
      },
    }));
  }

  function groupNodes(group: ClashProxyGroup) {
    const view = groupView(group.name);
    const keyword = view.filter.trim().toLocaleLowerCase();
    const nodes = group.nodes.filter(
      (node) =>
        !keyword ||
        `${node.name} ${node.kind}`.toLocaleLowerCase().includes(keyword),
    );
    if (view.sort === "name")
      nodes.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    if (view.sort === "delay")
      nodes.sort(
        (left, right) =>
          (left.delay ?? Number.MAX_SAFE_INTEGER) -
          (right.delay ?? Number.MAX_SAFE_INTEGER),
      );
    return nodes;
  }

  function locateCurrent(group: ClashProxyGroup) {
    updateGroupView(group.name, { open: true });
    window.setTimeout(
      () =>
        document
          .getElementById(
            `proxy-node-${encodeURIComponent(group.name)}-${encodeURIComponent(group.now ?? "")}`,
          )
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      0,
    );
  }

  function locateGroup(name: string) {
    updateGroupView(name, { open: true });
    window.setTimeout(
      () =>
        document
          .getElementById(`proxy-group-${encodeURIComponent(name)}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      0,
    );
  }
  const currentProfile =
    profiles.find((profile) => profile.active) ?? profiles[0];
  const visibleConnections = useMemo(() => {
    const keyword = filter.trim().toLocaleLowerCase();
    const source: ConnectionView[] =
      connectionTab === "active"
        ? connections.map((item) => ({
            ...item,
            ...(connectionRates[item.id] ?? { downloadRate: 0, uploadRate: 0 }),
          }))
        : closedConnections;
    return source
      .filter((item) =>
        `${item.host} ${item.sourceIp} ${item.destinationIp} ${item.process} ${item.processPath} ${item.rule} ${item.rulePayload} ${item.chains.join(" ")}`
          .toLocaleLowerCase()
          .includes(keyword),
      )
      .sort((left, right) => {
        if (connectionSort === "host")
          return left.host.localeCompare(right.host, "zh-CN");
        if (connectionSort === "traffic")
          return right.download + right.upload - (left.download + left.upload);
        return right[connectionSort] - left[connectionSort];
      });
  }, [
    connections,
    connectionRates,
    closedConnections,
    connectionTab,
    connectionSort,
    filter,
  ]);
  const visibleRules = rules.filter((item) =>
    `${item.kind} ${item.payload} ${item.proxy}`
      .toLocaleLowerCase()
      .includes(filter.trim().toLocaleLowerCase()),
  );

  async function addProfile() {
    const value = url.trim();
    if (!/^https?:\/\//i.test(value)) return;
    setProfileAction("import");
    setProfileMessage(null);
    try {
      await invoke<Profile>("import_clash_profile", {
        url: value,
        name: null,
        options: { basicRouting: quickBasicRouting },
      });
      setUrl("");
      setProfileMessage({
        kind: "success",
        text: "订阅已下载并通过 Clash YAML 校验",
      });
      await loadProfiles();
    } catch (error) {
      setProfileMessage({ kind: "error", text: String(error) });
    } finally {
      setProfileAction(null);
    }
  }

  async function pasteSubscriptionUrl() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) throw new Error("剪贴板中没有文本");
      setUrl(text);
      if (!/^https?:\/\//i.test(text)) {
        setProfileMessage({
          kind: "error",
          text: "剪贴板内容不是 HTTP/HTTPS 订阅链接",
        });
      }
    } catch (error) {
      setProfileMessage({
        kind: "error",
        text: `读取剪贴板失败：${String(error)}`,
      });
    }
  }

  function openNewProfile() {
    setNewProfile(EMPTY_NEW_PROFILE);
    setNewProfileOpen(true);
    setProfileMessage(null);
  }

  async function selectLocalFile(file: File | undefined) {
    if (!file) return;
    if (!/\.ya?ml$/i.test(file.name)) {
      setProfileMessage({ kind: "error", text: "只能选择 .yaml 或 .yml 文件" });
      return;
    }
    try {
      const content = await file.text();
      setNewProfile((current) => ({
        ...current,
        type: "local",
        name: current.name || file.name,
        fileName: file.name,
        content,
      }));
    } catch (error) {
      setProfileMessage({
        kind: "error",
        text: `读取本地配置失败：${String(error)}`,
      });
    }
  }

  async function submitNewProfile() {
    const interval = newProfile.updateInterval.trim()
      ? Math.max(1, Number(newProfile.updateInterval))
      : null;
    if (
      newProfile.type === "remote" &&
      !/^https?:\/\//i.test(newProfile.url.trim())
    ) {
      setProfileMessage({
        kind: "error",
        text: "请输入有效的 HTTP/HTTPS 订阅地址",
      });
      return;
    }
    if (newProfile.type === "local" && !newProfile.content.trim()) {
      setProfileMessage({ kind: "error", text: "请选择文件或粘贴 YAML 内容" });
      return;
    }
    setProfileAction("new-profile");
    setProfileMessage(null);
    try {
      if (newProfile.type === "remote") {
        await invoke("import_clash_profile", {
          url: newProfile.url.trim(),
          name: newProfile.name.trim() || null,
          options: {
            description: newProfile.description,
            userAgent: newProfile.userAgent,
            timeoutSeconds: newProfile.timeoutSeconds,
            proxyMode: newProfile.proxyMode,
            acceptInvalidCerts: newProfile.acceptInvalidCerts,
            allowAutoUpdate: newProfile.allowAutoUpdate,
            updateInterval: interval,
            fallbackToClash: true,
            basicRouting: newProfile.basicRouting,
          },
        });
        setProfileMessage({
          kind: "success",
          text: "远程订阅已下载、校验并保存",
        });
      } else {
        await invoke("import_clash_profile_local", {
          name: newProfile.name.trim() || newProfile.fileName || "本地配置",
          description: newProfile.description,
          content: newProfile.content,
          updateInterval: interval,
        });
        setProfileMessage({
          kind: "success",
          text: "本地 YAML 已通过 Mihomo 校验并导入",
        });
      }
      setNewProfileOpen(false);
      await loadProfiles();
    } catch (error) {
      setProfileMessage({ kind: "error", text: String(error) });
    } finally {
      setProfileAction(null);
    }
  }

  async function updateProfile(profile: Profile) {
    setProfileAction(profile.id);
    setProfileMessage(null);
    try {
      await invoke<Profile>("update_clash_profile", { profileId: profile.id });
      setProfileMessage({ kind: "success", text: `${profile.name} 已更新` });
    } catch (error) {
      setProfileMessage({ kind: "error", text: String(error) });
    } finally {
      await loadProfiles();
      setProfileAction(null);
    }
  }

  async function activateProfile(profile: Profile) {
    setProfileAction(profile.id);
    try {
      await invoke("start_clash_profile", { profileId: profile.id });
      setProfileMessage({
        kind: "success",
        text: `${profile.name} 已通过 mihomo 校验并启动`,
      });
      await loadProfiles();
    } catch (error) {
      setProfileMessage({ kind: "error", text: String(error) });
    } finally {
      setProfileAction(null);
    }
  }

  async function deleteProfile(profile: Profile) {
    setProfileAction(profile.id);
    setPendingDelete(null);
    try {
      await invoke("delete_clash_profile", { profileId: profile.id });
      setProfileMessage({ kind: "success", text: `${profile.name} 已删除` });
      await loadProfiles();
    } catch (error) {
      setProfileMessage({ kind: "error", text: String(error) });
    } finally {
      setProfileAction(null);
    }
  }

  function toggleProfile(profileId: string) {
    setSelectedProfiles((current) => {
      const next = new Set(current);
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      return next;
    });
  }

  async function openConfigDialog(
    mode: ConfigDialog["mode"],
    profile?: Profile,
  ) {
    setConfigDialog({ mode, profile });
    setConfigName(profile?.name ?? "");
    setConfigContent("");
    if (mode === "import" || !profile) return;
    setConfigLoading(true);
    try {
      setConfigContent(
        await invoke<string>(
          mode === "source"
            ? "get_clash_profile_source"
            : "get_clash_runtime_config",
          { profileId: profile.id },
        ),
      );
    } catch (error) {
      setProfileMessage({ kind: "error", text: String(error) });
      setConfigDialog(null);
    } finally {
      setConfigLoading(false);
    }
  }

  async function submitConfigDialog() {
    if (!configDialog || configDialog.mode === "runtime") return;
    setConfigLoading(true);
    setProfileMessage(null);
    try {
      if (configDialog.mode === "import") {
        await invoke("import_clash_profile_content", {
          name: configName,
          content: configContent,
        });
        setProfileMessage({
          kind: "success",
          text: "本地 YAML 已通过 Mihomo 校验并导入",
        });
      } else if (configDialog.profile) {
        await invoke("save_clash_profile_source", {
          profileId: configDialog.profile.id,
          content: configContent,
        });
        setProfileMessage({
          kind: "success",
          text: `${configDialog.profile.name} 已校验并保存`,
        });
      }
      setConfigDialog(null);
      await loadProfiles();
    } catch (error) {
      setProfileMessage({ kind: "error", text: String(error) });
    } finally {
      setConfigLoading(false);
    }
  }

  async function batchUpdateProfiles() {
    const profileIds = [...selectedProfiles];
    if (!profileIds.length) return;
    setProfileAction("batch");
    try {
      const result = await invoke<ClashBatchResult>("update_clash_profiles", {
        profileIds,
      });
      setProfileMessage(
        result.failed.length
          ? {
              kind: "error",
              text: `已更新 ${result.succeeded.length} 项，${result.failed.length} 项失败：${result.failed[0].error}`,
            }
          : {
              kind: "success",
              text: `已更新 ${result.succeeded.length} 项配置`,
            },
      );
      await loadProfiles();
    } catch (error) {
      setProfileMessage({ kind: "error", text: String(error) });
    } finally {
      setProfileAction(null);
    }
  }

  async function batchDeleteProfiles() {
    const profileIds = [...selectedProfiles];
    setPendingBatchDelete(false);
    setProfileAction("batch");
    try {
      const result = await invoke<ClashBatchResult>("delete_clash_profiles", {
        profileIds,
      });
      setSelectedProfiles(new Set(result.failed.map((item) => item.profileId)));
      setProfileMessage(
        result.failed.length
          ? {
              kind: "error",
              text: `已删除 ${result.succeeded.length} 项，${result.failed.length} 项未删除：${result.failed[0].error}`,
            }
          : {
              kind: "success",
              text: `已删除 ${result.succeeded.length} 项配置`,
            },
      );
      await loadProfiles();
    } catch (error) {
      setProfileMessage({ kind: "error", text: String(error) });
    } finally {
      setProfileAction(null);
    }
  }

  function formatProfileTime(value: number | null) {
    return value ? new Date(value * 1000).toLocaleString("zh-CN") : "尚未更新";
  }

  async function selectProxy(group: ClashProxyGroup, proxy: ClashProxyNode) {
    const key = `${group.name}:${proxy.name}:select`;
    setProxyActions((items) => ({ ...items, [key]: true }));
    try {
      await invoke("select_clash_proxy", {
        group: group.name,
        proxy: proxy.name,
      });
      await loadProxyGroups();
    } catch (error) {
      setProxyMessage(String(error));
    } finally {
      setProxyActions((items) => {
        const next = { ...items };
        delete next[key];
        return next;
      });
    }
  }

  async function testProxy(group: ClashProxyGroup, proxy: ClashProxyNode) {
    const key = `${group.name}:${proxy.name}:delay`;
    setProxyActions((items) => ({ ...items, [key]: true }));
    try {
      const delay = await invoke<number>("test_clash_proxy_delay", {
        proxy: proxy.name,
      });
      setProxyGroups((items) =>
        items.map((item) =>
          item.name === group.name
            ? {
                ...item,
                nodes: item.nodes.map((node) =>
                  node.name === proxy.name ? { ...node, delay } : node,
                ),
              }
            : item,
        ),
      );
    } catch (error) {
      setProxyMessage(String(error));
    } finally {
      setProxyActions((items) => {
        const next = { ...items };
        delete next[key];
        return next;
      });
    }
  }

  async function testGroup(group: ClashProxyGroup) {
    const key = `${group.name}:group-delay`;
    setProxyActions((items) => ({ ...items, [key]: true }));
    try {
      const delays = await invoke<Record<string, number>>(
        "test_clash_group_delay",
        { group: group.name },
      );
      setProxyGroups((items) =>
        items.map((item) =>
          item.name === group.name
            ? {
                ...item,
                nodes: item.nodes.map((node) =>
                  delays[node.name]
                    ? { ...node, delay: delays[node.name] }
                    : node,
                ),
              }
            : item,
        ),
      );
    } catch (error) {
      setProxyMessage(String(error));
    } finally {
      setProxyActions((items) => {
        const next = { ...items };
        delete next[key];
        return next;
      });
    }
  }

  async function setMode(mode: string) {
    const previous = proxyMode;
    setProxyMode(mode);
    try {
      await invoke("set_clash_mode", { mode });
    } catch (error) {
      setProxyMode(previous);
      setProxyMessage(String(error));
    }
  }

  async function providerAction(
    provider: ClashProxyProvider,
    action: "update" | "healthcheck",
  ) {
    const key = `provider:${provider.name}:${action}`;
    setProxyActions((items) => ({ ...items, [key]: true }));
    try {
      await invoke(
        action === "update"
          ? "update_clash_proxy_provider"
          : "healthcheck_clash_proxy_provider",
        { name: provider.name },
      );
      await loadProxyGroups();
    } catch (error) {
      setProxyMessage(String(error));
    } finally {
      setProxyActions((items) => {
        const next = { ...items };
        delete next[key];
        return next;
      });
    }
  }

  async function setBooleanSetting(
    key: "allowLan" | "ipv6" | "unifiedDelay",
    value: boolean,
  ) {
    setSettingsAction(key);
    try {
      const settings = await invoke<ClashSettings>(
        "set_clash_boolean_setting",
        { key, value },
      );
      setAllowLan(settings.allowLan);
      setIpv6(settings.ipv6);
      setUnifiedDelay(settings.unifiedDelay);
    } catch (error) {
      setProxyMessage(String(error));
    } finally {
      setSettingsAction(null);
    }
  }

  async function refreshClashCoreVersions(showMessage = true) {
    setSettingsAction("checkCore");
    if (showMessage) setCoreMessage(null);
    try {
      const [core, versions] = await Promise.all([
        invoke<string>("get_clash_core"),
        invoke<CoreVersionInfo[]>("check_clash_core_updates"),
      ]);
      setClashCore(core);
      setClashCoreVersions(versions);
      if (showMessage) setCoreMessage("内核版本检查完成");
    } catch (error) {
      setCoreMessage(`检查内核版本失败：${String(error)}`);
    } finally {
      setSettingsAction(null);
    }
  }

  async function changeClashCore(coreId: string) {
    if (coreId === clashCore) return;
    setSettingsAction(`core:${coreId}`);
    setCoreMessage(null);
    try {
      await invoke("set_clash_core", { coreId });
      setClashCore(coreId);
      setCoreMessage(
        coreId === "mihomo-alpha"
          ? "已切换到 Mihomo Alpha"
          : "已切换到 Mihomo Release",
      );
      void refreshClashCoreVersions(false);
    } catch (error) {
      setCoreMessage(`切换内核失败：${String(error)}`);
    } finally {
      setSettingsAction(null);
    }
  }

  async function updateActiveClashCore() {
    setSettingsAction("updateCore");
    setCoreMessage("正在下载并安装当前 Mihomo 内核…");
    try {
      const result = await invoke<{ version: string; checksumVerified: boolean }>(
        "update_clash_core",
      );
      setCoreMessage(
        `内核已更新到 ${result.version}${result.checksumVerified ? "，校验通过" : ""}`,
      );
      await refreshClashCoreVersions(false);
    } catch (error) {
      const message = String(error);
      setCoreMessage(
        message.includes("already")
          ? "已经是最新内核版本"
          : `更新内核失败：${message}`,
      );
    } finally {
      setSettingsAction(null);
    }
  }

  async function restartActiveClashCore() {
    setSettingsAction("restartCore");
    setCoreMessage(null);
    try {
      await invoke("restart_clash_core");
      setCoreMessage("Mihomo 内核已重启");
    } catch (error) {
      setCoreMessage(`重启内核失败：${String(error)}`);
    } finally {
      setSettingsAction(null);
    }
  }

  async function openActiveClashCoreDir() {
    setSettingsAction("openCoreDir");
    try {
      await invoke("open_clash_core_dir");
    } catch (error) {
      setCoreMessage(`打开内核目录失败：${String(error)}`);
    } finally {
      setSettingsAction(null);
    }
  }

  async function setRuntimeControl(
    kind: "systemProxy" | "tun",
    value: boolean,
  ) {
    setSettingsAction(kind);
    setProfileMessage(null);
    try {
      await invoke(
        kind === "systemProxy" ? "set_clash_system_proxy" : "set_clash_tun",
        { enabled: value },
      );
    } catch (error) {
      setProfileMessage({ kind: "error", text: String(error) });
    } finally {
      setSettingsAction(null);
    }
  }

  async function closeAllConnections() {
    setDataLoading(true);
    try {
      await invoke("close_all_clash_connections");
    } catch (error) {
      setProxyMessage(String(error));
    } finally {
      setDataLoading(false);
    }
  }

  async function closeConnection(id: string) {
    setDataLoading(true);
    try {
      await invoke("close_clash_connection", { id });
    } catch (error) {
      setProxyMessage(String(error));
    } finally {
      setDataLoading(false);
    }
  }

  async function testService(name: string, url: string) {
    setTestActions((items) => ({ ...items, [name]: true }));
    try {
      const result = await invoke<ServiceResult>("test_clash_service", { url });
      setServiceResults((items) => ({ ...items, [name]: result }));
    } catch (error) {
      setServiceResults((items) => ({
        ...items,
        [name]: { error: String(error) },
      }));
    } finally {
      setTestActions((items) => {
        const next = { ...items };
        delete next[name];
        return next;
      });
    }
  }

  async function testAllServices() {
    await Promise.all(
      SERVICE_TESTS.map(([name, url]) => testService(name, url)),
    );
  }

  function trafficPoints(values: number[]) {
    const max = Math.max(1, ...trafficHistory.down, ...trafficHistory.up);
    return values
      .map(
        (value, index) =>
          `${(index / Math.max(1, values.length - 1)) * 100},${38 - (value / max) * 34}`,
      )
      .join(" ");
  }

  return (
    <div className="clash-workspace">
      {proxyMessage && page !== "proxy" && (
        <div className="clash-message error">
          <span>{proxyMessage}</span>
          <button aria-label="关闭提示" onClick={() => setProxyMessage(null)}>
            ×
          </button>
        </div>
      )}
      {page === "home" && (
        <>
          <div className="clash-home-grid">
            <section className="clash-panel profile-summary">
              <header>
                <span className="clash-panel-icon">
                  <CloudOutlined />
                </span>
                <div>
                  <b>{currentProfile?.name ?? "暂无订阅"}</b>
                  <small>当前配置</small>
                </div>
                <button onClick={() => onPage("subscriptions")}>
                  订阅管理
                </button>
              </header>
              {currentProfile ? (
                <div className="profile-details">
                  <p>
                    <LinkOutlined />{" "}
                    {currentProfile.url
                      .replace(/^https?:\/\//, "")
                      .slice(0, 38)}
                  </p>
                  <p>
                    <ReloadOutlined /> 更新时间：
                    {formatProfileTime(currentProfile.updatedAt)}
                  </p>
                  <p>
                    <CloudDownloadOutlined /> 配置已保存到 KiNGO Clash 专属目录
                  </p>
                </div>
              ) : (
                <ClashEmpty
                  icon={<CloudOutlined />}
                  title="尚未添加 Clash 订阅"
                  text="前往订阅页面下载并校验 Clash 配置。"
                />
              )}
            </section>
            <section className="clash-panel node-summary">
              <header>
                <span className="clash-panel-icon">
                  <WifiOutlined />
                </span>
                <div>
                  <b>当前节点</b>
                  <small>代理组选择</small>
                </div>
                <button onClick={() => onPage("proxy")}>代理</button>
              </header>
              <div className="current-node">
                <span>
                  <RocketOutlined />
                </span>
                <div>
                  <small>{state.connected ? "当前连接" : "等待连接"}</small>
                  <b>{state.displayName ?? "尚未选择节点"}</b>
                  <p>{state.country ?? "导入配置并启动 Mihomo 后显示"}</p>
                </div>
                <em>{state.latency ? `${state.latency} ms` : "--"}</em>
              </div>
            </section>
            <section className="clash-panel network-control full">
              <header>
                <span className="clash-panel-icon">
                  <ApiOutlined />
                </span>
                <div>
                  <b>网络设置</b>
                  <small>Clash 专属控制</small>
                </div>
              </header>
              <div className="control-row">
                <div>
                  <b>系统代理</b>
                  <small>
                    {state.connected
                      ? "接管 Windows 系统代理"
                      : "启动配置后可用"}
                  </small>
                </div>
                <button
                  aria-label="切换系统代理"
                  disabled={!state.connected || settingsAction !== null}
                  className={`clash-switch ${state.systemProxyEnabled ? "on" : ""}`}
                  onClick={() =>
                    void setRuntimeControl(
                      "systemProxy",
                      !state.systemProxyEnabled,
                    )
                  }
                />
              </div>
              <div className="control-row">
                <div>
                  <b>虚拟网卡</b>
                  <small>
                    {state.connected
                      ? "Mihomo TUN 全局接管流量"
                      : "启动配置后可用"}
                  </small>
                </div>
                <button
                  aria-label="切换虚拟网卡"
                  disabled={!state.connected || settingsAction !== null}
                  className={`clash-switch ${state.tunEnabled ? "on" : ""}`}
                  onClick={() =>
                    void setRuntimeControl("tun", !state.tunEnabled)
                  }
                />
              </div>
            </section>
          </div>
          <section className="clash-panel traffic-panel">
            <header>
              <span className="clash-panel-icon warm">
                <ThunderboltOutlined />
              </span>
              <div>
                <b>流量统计</b>
                <small>
                  {realtime.traffic
                    ? "WebSocket 实时流量"
                    : state.connected
                      ? "实时通道重连中"
                      : "暂无活动会话"}
                </small>
              </div>
            </header>
            <div className="traffic-placeholder">
              <svg viewBox="0 0 100 40" preserveAspectRatio="none">
                <polyline
                  className="traffic-line down"
                  points={trafficPoints(trafficHistory.down)}
                />
                <polyline
                  className="traffic-line up"
                  points={trafficPoints(trafficHistory.up)}
                />
              </svg>
            </div>
            <div className="traffic-stats">
              <article>
                <small>上传速度</small>
                <b>{formatBytes(state.uploadBps, true)}</b>
              </article>
              <article>
                <small>下载速度</small>
                <b>{formatBytes(state.downloadBps, true)}</b>
              </article>
              <article>
                <small>累计流量</small>
                <b>{formatBytes(state.uploadTotal + state.downloadTotal)}</b>
              </article>
            </div>
          </section>
        </>
      )}

      {page === "proxy" && (
        <section className="clash-panel clash-content-panel">
          <div className="clash-toolbar">
            <div className="mode-buttons compact">
              {[
                ["rule", "规则"],
                ["global", "全局"],
                ["direct", "直连"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={proxyMode === id ? "active" : ""}
                  onClick={() => void setMode(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="proxy-tools">
              <select
                aria-label="代理组导航"
                defaultValue=""
                onChange={(event) => {
                  if (event.target.value) locateGroup(event.target.value);
                  event.target.value = "";
                }}
              >
                <option value="">定位代理组</option>
                {proxyGroups.map((group) => (
                  <option key={group.name} value={group.name}>
                    {group.name}
                  </option>
                ))}
              </select>
              <div className="filter-box">
                <SearchOutlined />
                <input
                  value={proxyFilter}
                  onChange={(event) => setProxyFilter(event.target.value)}
                  placeholder="过滤全部节点"
                />
              </div>
              <select
                value={proxySort}
                onChange={(event) =>
                  setProxySort(event.target.value as typeof proxySort)
                }
              >
                <option value="default">全局默认排序</option>
                <option value="delay">全局按延迟</option>
                <option value="name">全局按名称</option>
              </select>
              <button
                onClick={() =>
                  setProxyGroupViews((current) =>
                    Object.fromEntries(
                      proxyGroups.map((group) => [
                        group.name,
                        {
                          ...(current[group.name] ?? {
                            filter: "",
                            sort: "default",
                          }),
                          open: false,
                        },
                      ]),
                    ),
                  )
                }
              >
                全部折叠
              </button>
              <button
                disabled={proxyLoading || !state.connected}
                onClick={() => void loadProxyGroups()}
              >
                <ReloadOutlined /> {proxyLoading ? "刷新中" : "刷新"}
              </button>
            </div>
          </div>
          {proxyMessage && (
            <div className="clash-message error">
              <span>{proxyMessage}</span>
              <button
                aria-label="关闭提示"
                onClick={() => setProxyMessage(null)}
              >
                ×
              </button>
            </div>
          )}
          {state.connected && state.mode === "clash" ? (
            <div className="proxy-groups">
              {visibleProxyGroups.map((group) => {
                const view = groupView(group.name);
                const nodes = groupNodes(group);
                return (
                  <div
                    id={`proxy-group-${encodeURIComponent(group.name)}`}
                    className={`proxy-group ${view.open ? "open" : "collapsed"}`}
                    key={group.name}
                  >
                    <header>
                      <button
                        className="group-heading"
                        aria-expanded={view.open}
                        onClick={() =>
                          updateGroupView(group.name, { open: !view.open })
                        }
                      >
                        <span className="fold-mark">
                          {view.open ? "▾" : "▸"}
                        </span>
                        <RocketOutlined />
                        <span>
                          {group.name}
                          <small>
                            {group.kind} · 当前：{group.now ?? "未选择"}
                          </small>
                        </span>
                      </button>
                      <div className="group-actions">
                        <button
                          disabled={!group.now}
                          onClick={() => locateCurrent(group)}
                        >
                          当前节点
                        </button>
                        <button
                          disabled={
                            !!proxyActions[`${group.name}:group-delay`] ||
                            group.nodes.length === 0
                          }
                          onClick={() => void testGroup(group)}
                        >
                          <ReloadOutlined />{" "}
                          {proxyActions[`${group.name}:group-delay`]
                            ? "测试中"
                            : "整组测速"}
                        </button>
                        <span>{group.nodes.length}</span>
                      </div>
                    </header>
                    {view.open && (
                      <>
                        <div className="proxy-group-tools">
                          <div className="filter-box">
                            <SearchOutlined />
                            <input
                              value={view.filter}
                              onChange={(event) =>
                                updateGroupView(group.name, {
                                  filter: event.target.value,
                                })
                              }
                              placeholder="过滤本组名称或类型"
                            />
                          </div>
                          <select
                            value={view.sort}
                            onChange={(event) =>
                              updateGroupView(group.name, {
                                sort: event.target
                                  .value as ProxyGroupView["sort"],
                              })
                            }
                          >
                            <option value="default">跟随全局排序</option>
                            <option value="delay">按延迟</option>
                            <option value="name">按名称</option>
                          </select>
                          <small>
                            显示 {nodes.length} / {group.nodes.length}
                          </small>
                        </div>
                        <div className="proxy-grid">
                          {nodes.map((proxy) => (
                            <article
                              id={`proxy-node-${encodeURIComponent(group.name)}-${encodeURIComponent(proxy.name)}`}
                              className={`proxy-node ${group.now === proxy.name ? "selected" : ""}`}
                              key={proxy.name}
                            >
                              <button
                                className="proxy-select"
                                disabled={
                                  !!proxyActions[
                                    `${group.name}:${proxy.name}:select`
                                  ]
                                }
                                onClick={() => void selectProxy(group, proxy)}
                              >
                                <div>
                                  <b>{proxy.name}</b>
                                  <small>{proxy.kind}</small>
                                </div>
                              </button>
                              <button
                                className="proxy-delay"
                                disabled={
                                  !!proxyActions[
                                    `${group.name}:${proxy.name}:delay`
                                  ]
                                }
                                onClick={() => void testProxy(group, proxy)}
                              >
                                {proxyActions[
                                  `${group.name}:${proxy.name}:delay`
                                ]
                                  ? "测试中"
                                  : proxy.delay
                                    ? `${proxy.delay} ms`
                                    : "测速"}
                              </button>
                            </article>
                          ))}
                        </div>
                        {nodes.length === 0 && (
                          <div className="proxy-group-empty">
                            本组没有匹配的节点
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <ClashEmpty
              icon={<ApartmentOutlined />}
              title="尚未加载代理组"
              text="导入订阅并启动 Mihomo 后，此处将显示真实代理组、节点和延迟。"
            />
          )}
          {state.connected &&
            state.mode === "clash" &&
            proxyProviders.length > 0 && (
              <div className="provider-section">
                <header>
                  <b>Proxy Provider</b>
                  <small>{proxyProviders.length} 个</small>
                </header>
                <div className="provider-grid">
                  {proxyProviders.map((provider) => (
                    <article key={provider.name}>
                      <div>
                        <b>{provider.name}</b>
                        <small>
                          {provider.vehicleType} · {provider.nodeCount} 个节点
                        </small>
                        <em>
                          {provider.updatedAt
                            ? new Date(provider.updatedAt).toLocaleString(
                                "zh-CN",
                              )
                            : "尚未更新"}
                        </em>
                      </div>
                      <footer>
                        <button
                          disabled={
                            !!proxyActions[`provider:${provider.name}:update`]
                          }
                          onClick={() =>
                            void providerAction(provider, "update")
                          }
                        >
                          <ReloadOutlined />{" "}
                          {proxyActions[`provider:${provider.name}:update`]
                            ? "更新中"
                            : "更新"}
                        </button>
                        <button
                          disabled={
                            !!proxyActions[
                              `provider:${provider.name}:healthcheck`
                            ]
                          }
                          onClick={() =>
                            void providerAction(provider, "healthcheck")
                          }
                        >
                          {proxyActions[`provider:${provider.name}:healthcheck`]
                            ? "检查中"
                            : "健康检查"}
                        </button>
                      </footer>
                    </article>
                  ))}
                </div>
              </div>
            )}
          {state.connected &&
            state.mode === "clash" &&
            !proxyLoading &&
            !proxyGroups.length &&
            !proxyMessage && (
              <ClashEmpty
                icon={<ApartmentOutlined />}
                title="配置中没有可选择的代理组"
                text="DIRECT 等固定出口不会显示为可选代理组。"
              />
            )}
        </section>
      )}

      {page === "subscriptions" && (
        <>
          <div className="subscription-bar">
            <div className="subscription-url-input">
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addProfile();
                }}
                placeholder="输入 Clash 订阅链接"
              />
              <button
                title="粘贴订阅链接"
                onClick={() => void pasteSubscriptionUrl()}
              >
                <CopyOutlined />
              </button>
            </div>
            <button
              disabled={
                !/^https?:\/\//i.test(url.trim()) || profileAction === "import"
              }
              onClick={() => void addProfile()}
            >
              <PlusOutlined /> {profileAction === "import" ? "下载中" : "导入"}
            </button>
            <button className="secondary" onClick={openNewProfile}>
              <FolderOpenOutlined /> 新建
            </button>
          </div>
          <label className="subscription-routing-option">
            <input
              type="checkbox"
              checked={quickBasicRouting}
              onChange={(event) => setQuickBasicRouting(event.target.checked)}
            />
            <span>
              订阅缺少代理组或规则时，应用基础分流模板
              {quickBasicRouting && (
                <small>创建“节点选择”组，并追加 MATCH 兜底规则</small>
              )}
            </span>
          </label>
          {profileMessage && (
            <div className={`subscription-message ${profileMessage.kind}`}>
              <span>{profileMessage.text}</span>
              <button
                aria-label="关闭提示"
                onClick={() => setProfileMessage(null)}
              >
                ×
              </button>
            </div>
          )}
          {dragActive && (
            <div className="clash-file-drop">
              <FolderOpenOutlined />
              <b>释放以导入 YAML</b>
              <small>支持同时拖入多个 .yaml / .yml 文件</small>
            </div>
          )}
          {selectedProfiles.size > 0 && (
            <div className="profile-batch-bar">
              <b>已选择 {selectedProfiles.size} 项</b>
              <button
                disabled={profileAction === "batch"}
                onClick={() => void batchUpdateProfiles()}
              >
                <ReloadOutlined /> 批量更新
              </button>
              <button
                className="danger"
                disabled={profileAction === "batch"}
                onClick={() => setPendingBatchDelete(true)}
              >
                <DeleteOutlined /> 批量删除
              </button>
              <button onClick={() => setSelectedProfiles(new Set())}>
                取消选择
              </button>
            </div>
          )}
          <div className="profile-grid">
            {profiles.map((profile) => (
              <article
                className={`profile-card ${profile.active ? "active" : ""} ${selectedProfiles.has(profile.id) ? "selected" : ""}`}
                key={profile.id}
              >
                <div>
                  <input
                    className="profile-checkbox"
                    type="checkbox"
                    checked={selectedProfiles.has(profile.id)}
                    onChange={() => toggleProfile(profile.id)}
                    aria-label={`选择 ${profile.name}`}
                  />
                  <ProfileOutlined />
                  <b>{profile.name}</b>
                  {profile.active && <span className="soft-tag">当前</span>}
                </div>
                <p>{profile.source === "local" ? "本地 YAML" : profile.url}</p>
                {profile.description && (
                  <small className="profile-description">
                    {profile.description}
                  </small>
                )}
                <small>
                  {formatProfileTime(profile.updatedAt)}
                  {profile.lastError
                    ? ` · ${profile.lastError}`
                    : " · Mihomo 可用"}
                </small>
                {profile.source === "url" && (
                  <div className="profile-meta">
                    <span>
                      {profile.allowAutoUpdate && profile.updateInterval
                        ? `每 ${profile.updateInterval} 分钟更新`
                        : "手动更新"}
                    </span>
                    {profile.total > 0 && (
                      <span>
                        已用 {formatBytes(profile.upload + profile.download)} /{" "}
                        {formatBytes(profile.total)}
                      </span>
                    )}
                    {profile.expire > 0 && (
                      <span>
                        到期{" "}
                        {new Date(profile.expire * 1000).toLocaleDateString(
                          "zh-CN",
                        )}
                      </span>
                    )}
                  </div>
                )}
                <footer>
                  <button
                    disabled={
                      profileAction === profile.id || profile.source === "local"
                    }
                    onClick={() => void updateProfile(profile)}
                    title={
                      profile.source === "local"
                        ? "本地配置请使用编辑功能"
                        : "更新远程订阅"
                    }
                  >
                    <ReloadOutlined /> 更新
                  </button>
                  <button
                    onClick={() => void openConfigDialog("source", profile)}
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => void openConfigDialog("runtime", profile)}
                  >
                    运行配置
                  </button>
                  <button
                    disabled={
                      profileAction === profile.id ||
                      (profile.active && state.connected)
                    }
                    onClick={() => void activateProfile(profile)}
                  >
                    {profile.active && state.connected
                      ? "运行中"
                      : profile.active
                        ? "启动"
                        : "切换并启动"}
                  </button>
                  <button
                    className="danger"
                    disabled={profileAction === profile.id}
                    onClick={() => setPendingDelete(profile)}
                  >
                    <DeleteOutlined />
                  </button>
                </footer>
              </article>
            ))}
          </div>
          {!profilesLoading && !profiles.length && (
            <section className="clash-panel">
              <ClashEmpty
                icon={<ProfileOutlined />}
                title="暂无 Clash 订阅"
                text="添加订阅后，KiNGO 会真实下载、校验并保存到 Clash 专属空间。"
              />
            </section>
          )}
          {profilesLoading && (
            <section className="clash-panel">
              <ClashEmpty
                icon={<ReloadOutlined />}
                title="正在读取 Clash 订阅"
                text="正在加载 KiNGO 数据目录中的配置。"
              />
            </section>
          )}
        </>
      )}

      {page === "connections" && (
        <section className="clash-panel clash-content-panel">
          <div className="clash-toolbar connection-toolbar">
            <div className="connection-tabs">
              <button
                className={connectionTab === "active" ? "active" : ""}
                onClick={() => setConnectionTab("active")}
              >
                活动连接 <span>{connections.length}</span>
              </button>
              <button
                className={connectionTab === "closed" ? "active" : ""}
                onClick={() => setConnectionTab("closed")}
              >
                已关闭 <span>{closedConnections.length}</span>
              </button>
            </div>
            <div className="connection-toolbar-actions">
              <div className="filter-box">
                <SearchOutlined />
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="主机、地址、进程、规则"
                />
              </div>
              <select
                value={connectionSort}
                onChange={(event) =>
                  setConnectionSort(event.target.value as typeof connectionSort)
                }
              >
                <option value="downloadRate">下载速度</option>
                <option value="uploadRate">上传速度</option>
                <option value="traffic">累计流量</option>
                <option value="host">目标名称</option>
              </select>
              <span
                className={
                  realtime.connections
                    ? "realtime-state online"
                    : "realtime-state"
                }
              >
                {realtime.connections ? "实时" : "降级"}
              </span>
              {connectionTab === "active" ? (
                <button
                  disabled={
                    !state.connected || dataLoading || connections.length === 0
                  }
                  onClick={() => void closeAllConnections()}
                >
                  {dataLoading ? "处理中" : "关闭全部"}
                </button>
              ) : (
                <button
                  disabled={!closedConnections.length}
                  onClick={() => setClosedConnections([])}
                >
                  清空历史
                </button>
              )}
            </div>
          </div>
          {visibleConnections.length ? (
            <div className="connection-list detailed">
              {visibleConnections.map((item) => (
                <div
                  className={item.closedAt ? "closed" : ""}
                  key={`${item.id}-${item.closedAt ?? "active"}`}
                  onDoubleClick={() => setConnectionDetail(item)}
                >
                  <span
                    className={`status-dot ${item.closedAt ? "" : "online"}`}
                  />
                  <button
                    className="connection-target"
                    onClick={() => setConnectionDetail(item)}
                  >
                    <b>{item.host}</b>
                    <small>
                      {item.destinationIp || "未知地址"}:
                      {item.destinationPort || "-"}
                    </small>
                  </button>
                  <span className="connection-process">
                    {item.process || "未知进程"}
                    <small>
                      {item.network || "-"} · {item.connectionType || "-"}
                    </small>
                  </span>
                  <span className="connection-chain">
                    {item.chains.join(" → ") || "DIRECT"}
                    <small>
                      {item.rule}
                      {item.rulePayload ? ` · ${item.rulePayload}` : ""}
                    </small>
                  </span>
                  <em>
                    <b>
                      ↓ {formatBytes(item.downloadRate, true)}　↑{" "}
                      {formatBytes(item.uploadRate, true)}
                    </b>
                    <small>
                      累计 {formatBytes(item.download + item.upload)}
                    </small>
                  </em>
                  {item.closedAt ? (
                    <time>
                      {new Date(item.closedAt).toLocaleTimeString("zh-CN")}
                    </time>
                  ) : (
                    <button
                      className="connection-close"
                      disabled={dataLoading}
                      onClick={() => void closeConnection(item.id)}
                    >
                      关闭
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <ClashEmpty
              icon={<SwapOutlined />}
              title={
                dataLoading
                  ? "正在处理连接"
                  : connectionTab === "closed"
                    ? "暂无已关闭连接"
                    : "暂无活动连接"
              }
              text={
                connectionTab === "closed"
                  ? "本次运行最多保留 100 条关闭记录。"
                  : realtime.connections
                    ? "这里显示 Mihomo WebSocket 推送的真实会话。"
                    : "实时通道正在重连，当前显示最近一次连接快照。"
              }
            />
          )}
        </section>
      )}

      {page === "rules" && (
        <section className="clash-panel clash-content-panel">
          <div className="clash-toolbar">
            <div className="filter-box">
              <SearchOutlined />
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="过滤规则"
              />
            </div>
            <span className="soft-tag">{visibleRules.length} 条规则</span>
          </div>
          {visibleRules.length ? (
            <div className="rule-list">
              {visibleRules.map((item, index) => (
                <div key={`${item.kind}-${item.payload}-${index}`}>
                  <b>{item.kind}</b>
                  <span>{item.payload}</span>
                  <em>{item.proxy}</em>
                </div>
              ))}
            </div>
          ) : (
            <ClashEmpty
              icon={<CodeOutlined />}
              title={dataLoading ? "正在读取规则" : "暂无匹配规则"}
              text="规则来自当前 Mihomo 配置。"
            />
          )}
        </section>
      )}

      {page === "logs" && (
        <section className="clash-panel clash-content-panel">
          <div className="clash-toolbar">
            <div className="connection-toolbar-actions">
              <span className="soft-tag">CLASH / MIHOMO</span>
              <span
                className={
                  realtime.logs ? "realtime-state online" : "realtime-state"
                }
              >
                {realtime.logs ? "实时" : "降级"}
              </span>
            </div>
            <button
              disabled={!clashLogs.length}
              onClick={() => setLogStart(logs.length)}
            >
              清空显示
            </button>
          </div>
          {clashLogs.length ? (
            <div className="clash-log-list">
              {clashLogs.map((entry, index) => (
                <div key={`${entry.at}-${index}`}>
                  <time>{entry.at}</time>
                  <span className={entry.level}>{entry.level}</span>
                  <p>{entry.message}</p>
                </div>
              ))}
            </div>
          ) : (
            <ClashEmpty
              icon={<FileTextOutlined />}
              title="暂无 Clash 日志"
              text="这里只显示 Clash 与 Mihomo 相关记录，不混入全自动线路日志。"
            />
          )}
        </section>
      )}

      {page === "tests" && (
        <>
          <div className="test-toolbar">
            <p>通过当前 Mihomo 代理检测服务连通性</p>
            <button
              disabled={!state.connected || Object.keys(testActions).length > 0}
              onClick={() => void testAllServices()}
            >
              <ReloadOutlined />{" "}
              {Object.keys(testActions).length ? "测试中" : "测试全部"}
            </button>
          </div>
          <div className="unlock-grid">
            {SERVICE_TESTS.map(([name, url]) => {
              const result = serviceResults[name];
              const ok = result && !("error" in result) && result.status < 500;
              return (
                <article
                  className={ok ? "available" : result ? "failed" : ""}
                  key={name}
                >
                  <div>
                    <b>{name}</b>
                    <button
                      disabled={!state.connected || !!testActions[name]}
                      onClick={() => void testService(name, url)}
                    >
                      <ReloadOutlined />
                    </button>
                  </div>
                  <span>
                    {testActions[name]
                      ? "检测中"
                      : ok
                        ? "可访问"
                        : result
                          ? "不可用"
                          : state.connected
                            ? "待检测"
                            : "等待连接"}
                  </span>
                  <small>
                    {result && !("error" in result)
                      ? `${result.status} · ${result.latency} ms`
                      : result && "error" in result
                        ? result.error
                        : "--"}
                  </small>
                </article>
              );
            })}
          </div>
        </>
      )}

      {page === "settings" && (
        <div className="clash-settings-grid">
          <section className="clash-panel settings-block">
            <h3>系统设置</h3>
            <label>
              <div>
                <b>系统代理</b>
                <small>由 Mihomo 连接状态自动管理</small>
              </div>
              <span className={state.connected ? "status-ok" : "soft-tag"}>
                {state.connected ? "已开启" : "未开启"}
              </span>
            </label>
            <label>
              <div>
                <b>局域网连接</b>
                <small>允许其他设备访问本地代理端口</small>
              </div>
              <button
                disabled={settingsAction === "allowLan"}
                className={`clash-switch ${allowLan ? "on" : ""}`}
                onClick={() => void setBooleanSetting("allowLan", !allowLan)}
              />
            </label>
          </section>
          <section className="clash-panel settings-block">
            <h3>Clash 设置</h3>
            <label>
              <div>
                <b>IPv6</b>
                <small>允许代理配置使用 IPv6</small>
              </div>
              <button
                disabled={settingsAction === "ipv6"}
                className={`clash-switch ${ipv6 ? "on" : ""}`}
                onClick={() => void setBooleanSetting("ipv6", !ipv6)}
              />
            </label>
            <label>
              <div>
                <b>统一延迟</b>
                <small>统一计算节点延迟结果</small>
              </div>
              <button
                disabled={settingsAction === "unifiedDelay"}
                className={`clash-switch ${unifiedDelay ? "on" : ""}`}
                onClick={() =>
                  void setBooleanSetting("unifiedDelay", !unifiedDelay)
                }
              />
            </label>
            <label>
              <div>
                <b>端口设置</b>
                <small>Mixed 7890 · Controller 9090</small>
              </div>
              <span className="soft-tag">默认</span>
            </label>
          </section>
          <section className="clash-panel settings-block full">
            <div className="clash-core-heading">
              <div>
                <h3>Mihomo 内核</h3>
                <small>
                  {state.connected
                    ? `运行中 · ${state.coreId === "mihomo-alpha" ? "Alpha" : "Release"}`
                    : "Release / Alpha 通道独立管理"}
                </small>
              </div>
              <div className="clash-core-actions">
                <button
                  disabled={settingsAction !== null}
                  onClick={() => void refreshClashCoreVersions()}
                >
                  <ReloadOutlined /> 检查
                </button>
                <button
                  disabled={settingsAction !== null}
                  onClick={() => void openActiveClashCoreDir()}
                >
                  <FolderOpenOutlined /> 目录
                </button>
                <button
                  disabled={settingsAction !== null || !currentProfile}
                  onClick={() => void restartActiveClashCore()}
                >
                  <RocketOutlined /> 重启
                </button>
                <button
                  className="primary"
                  disabled={settingsAction !== null}
                  onClick={() => void updateActiveClashCore()}
                >
                  <CloudDownloadOutlined /> 更新
                </button>
              </div>
            </div>
            {coreMessage && (
              <div className="clash-core-message">{coreMessage}</div>
            )}
            <div className="clash-core-list">
              {["mihomo", "mihomo-alpha"].map((coreId) => {
                const info = clashCoreVersions.find(
                  (item) => item.coreId === coreId,
                );
                const active = clashCore === coreId;
                return (
                  <button
                    key={coreId}
                    className={`clash-core-option ${active ? "active" : ""}`}
                    disabled={settingsAction !== null}
                    onClick={() => void changeClashCore(coreId)}
                  >
                    <span>
                      <b>
                        {coreId === "mihomo-alpha"
                          ? "Mihomo Alpha"
                          : "Mihomo"}
                      </b>
                      <small>/{coreId}</small>
                    </span>
                    <span className="clash-core-meta">
                      <em>{coreId === "mihomo-alpha" ? "Alpha" : "Release"}</em>
                      <small>
                        当前{" "}
                        {info?.currentVersion
                          ? `v${info.currentVersion}`
                          : info?.available
                            ? "未知"
                            : "缺失"}
                      </small>
                      <small>
                        最新{" "}
                        {info?.latestVersion
                          ? `v${info.latestVersion}`
                          : info?.error
                            ? "检查失败"
                            : "未检查"}
                      </small>
                    </span>
                    <span
                      className={
                        info?.outdated || !info?.available
                          ? "core-status update"
                          : "core-status ok"
                      }
                    >
                      {active ? (
                        <>
                          <CheckCircleOutlined /> 当前
                        </>
                      ) : info?.outdated || !info?.available ? (
                        "可更新"
                      ) : (
                        "可切换"
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="clash-core-legacy-placeholder">
            <h3>Mihomo 核心</h3>
            <label>
              <div>
                <b>运行状态</b>
                <small>
                  {state.connected ? "核心正在运行" : "等待 Clash 配置接入"}
                </small>
              </div>
              <span className={state.connected ? "status-ok" : "soft-tag"}>
                {state.connected ? (
                  <>
                    <CheckCircleOutlined /> 正常
                  </>
                ) : (
                  "未启动"
                )}
              </span>
            </label>
            <label>
              <div>
                <b>功能隔离</b>
                <small>Clash 配置、订阅与设置使用独立命名空间</small>
              </div>
              <span className="status-ok">
                <LockOutlined /> 已隔离
              </span>
            </label>
            </div>
          </section>
        </div>
      )}
      {pendingDelete && (
        <div
          className="clash-modal-backdrop"
          role="presentation"
          onMouseDown={() => setPendingDelete(null)}
        >
          <div
            className="clash-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-clash-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h3 id="delete-clash-title">删除 Clash 订阅</h3>
            <p>
              确定删除“{pendingDelete.name}”吗？本地 YAML 文件也会被移除。
              {pendingDelete.active && state.connected
                ? " 当前配置正在运行，KiNGO 将先切换到下一份配置。"
                : " 此操作不可逆。"}
            </p>
            <footer>
              <button onClick={() => setPendingDelete(null)}>取消</button>
              <button
                className="danger"
                onClick={() => void deleteProfile(pendingDelete)}
              >
                删除
              </button>
            </footer>
          </div>
        </div>
      )}
      {pendingBatchDelete && (
        <div
          className="clash-modal-backdrop"
          role="presentation"
          onMouseDown={() => setPendingBatchDelete(false)}
        >
          <div
            className="clash-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h3>批量删除 Clash 配置</h3>
            <p>
              确定删除选中的 {selectedProfiles.size}{" "}
              项配置吗？如果包含当前配置，KiNGO
              会自动切换到下一份未删除配置；此操作不可逆。
            </p>
            <footer>
              <button onClick={() => setPendingBatchDelete(false)}>取消</button>
              <button
                className="danger"
                onClick={() => void batchDeleteProfiles()}
              >
                删除
              </button>
            </footer>
          </div>
        </div>
      )}
      {configDialog && (
        <div
          className="clash-modal-backdrop"
          role="presentation"
          onMouseDown={() => !configLoading && setConfigDialog(null)}
        >
          <div
            className="clash-modal config-editor-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h3>
                  {configDialog.mode === "import"
                    ? "导入本地 YAML"
                    : configDialog.mode === "source"
                      ? `编辑 ${configDialog.profile?.name}`
                      : `${configDialog.profile?.name} · 运行配置`}
                </h3>
                <small>
                  {configDialog.mode === "runtime"
                    ? "已注入 KiNGO 运行端口与控制器，只读"
                    : "保存前同时执行 YAML 与 Mihomo 完整校验"}
                </small>
              </div>
              <button onClick={() => setConfigDialog(null)}>×</button>
            </header>
            {configDialog.mode === "import" && (
              <input
                className="config-name-input"
                value={configName}
                onChange={(event) => setConfigName(event.target.value)}
                placeholder="配置名称"
              />
            )}
            <textarea
              value={configContent}
              onChange={(event) => setConfigContent(event.target.value)}
              readOnly={configDialog.mode === "runtime" || configLoading}
              spellCheck={false}
              placeholder={
                configLoading ? "正在读取配置…" : "粘贴 Clash YAML 配置"
              }
            />
            <footer>
              <button onClick={() => setConfigDialog(null)}>关闭</button>
              {configDialog.mode !== "runtime" && (
                <button
                  className="primary"
                  disabled={
                    configLoading ||
                    !configContent.trim() ||
                    (configDialog.mode === "import" && !configName.trim())
                  }
                  onClick={() => void submitConfigDialog()}
                >
                  {configLoading ? "校验中" : "校验并保存"}
                </button>
              )}
            </footer>
          </div>
        </div>
      )}
      {newProfileOpen && (
        <div
          className="clash-modal-backdrop"
          role="presentation"
          onMouseDown={() =>
            profileAction !== "new-profile" && setNewProfileOpen(false)
          }
        >
          <div
            className="clash-modal new-profile-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h3>新建 Clash 订阅</h3>
                <small>远程订阅与本地 YAML 使用同一套校验和配置库</small>
              </div>
              <button onClick={() => setNewProfileOpen(false)}>×</button>
            </header>
            <div className="new-profile-type">
              <button
                className={newProfile.type === "remote" ? "active" : ""}
                onClick={() =>
                  setNewProfile((current) => ({ ...current, type: "remote" }))
                }
              >
                Remote
              </button>
              <button
                className={newProfile.type === "local" ? "active" : ""}
                onClick={() =>
                  setNewProfile((current) => ({ ...current, type: "local" }))
                }
              >
                Local
              </button>
            </div>
            <div className="new-profile-form">
              <label>
                <span>名称</span>
                <input
                  value={newProfile.name}
                  onChange={(event) =>
                    setNewProfile((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder={
                    newProfile.type === "remote"
                      ? "可留空，由订阅自动识别"
                      : "本地配置名称"
                  }
                />
              </label>
              <label>
                <span>描述</span>
                <input
                  value={newProfile.description}
                  onChange={(event) =>
                    setNewProfile((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="可选"
                />
              </label>
              {newProfile.type === "remote" ? (
                <>
                  <label className="wide">
                    <span>订阅 URL</span>
                    <textarea
                      value={newProfile.url}
                      onChange={(event) =>
                        setNewProfile((current) => ({
                          ...current,
                          url: event.target.value,
                        }))
                      }
                      placeholder="https://example.com/subscription"
                    />
                  </label>
                  <label>
                    <span>User-Agent</span>
                    <input
                      value={newProfile.userAgent}
                      onChange={(event) =>
                        setNewProfile((current) => ({
                          ...current,
                          userAgent: event.target.value,
                        }))
                      }
                      placeholder="clash-verge-rev/v2.5.2"
                    />
                  </label>
                  <label>
                    <span>HTTP 超时（秒）</span>
                    <input
                      type="number"
                      min="5"
                      max="300"
                      value={newProfile.timeoutSeconds}
                      onChange={(event) =>
                        setNewProfile((current) => ({
                          ...current,
                          timeoutSeconds: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>下载方式</span>
                    <select
                      value={newProfile.proxyMode}
                      onChange={(event) =>
                        setNewProfile((current) => ({
                          ...current,
                          proxyMode: event.target
                            .value as NewProfileForm["proxyMode"],
                        }))
                      }
                    >
                      <option value="system">系统代理</option>
                      <option value="direct">直连</option>
                      <option value="clash">当前 Clash 代理</option>
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <label className="wide file-picker">
                    <span>本地 YAML 文件</span>
                    <input
                      id="clash-local-file"
                      type="file"
                      accept=".yaml,.yml,text/yaml"
                      onChange={(event) =>
                        void selectLocalFile(event.target.files?.[0])
                      }
                    />
                    <label htmlFor="clash-local-file">
                      <FolderOpenOutlined />{" "}
                      {newProfile.fileName || "选择 .yaml / .yml 文件"}
                    </label>
                  </label>
                  <label className="wide">
                    <span>YAML 内容</span>
                    <textarea
                      className="local-yaml-input"
                      value={newProfile.content}
                      onChange={(event) =>
                        setNewProfile((current) => ({
                          ...current,
                          content: event.target.value,
                        }))
                      }
                      placeholder="选择文件后自动读取，也可以直接粘贴 YAML"
                    />
                  </label>
                </>
              )}
              <label>
                <span>更新间隔（分钟）</span>
                <input
                  type="number"
                  min="1"
                  value={newProfile.updateInterval}
                  onChange={(event) =>
                    setNewProfile((current) => ({
                      ...current,
                      updateInterval: event.target.value,
                    }))
                  }
                  placeholder="留空则不定时更新"
                />
              </label>
              {newProfile.type === "remote" && (
                <div className="new-profile-switches wide">
                  <label>
                    <input
                      type="checkbox"
                      checked={newProfile.allowAutoUpdate}
                      onChange={(event) =>
                        setNewProfile((current) => ({
                          ...current,
                          allowAutoUpdate: event.target.checked,
                        }))
                      }
                    />
                    <span>允许自动更新</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={newProfile.basicRouting}
                      onChange={(event) =>
                        setNewProfile((current) => ({
                          ...current,
                          basicRouting: event.target.checked,
                        }))
                      }
                    />
                    <span>缺少规则时应用基础分流</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={newProfile.acceptInvalidCerts}
                      onChange={(event) =>
                        setNewProfile((current) => ({
                          ...current,
                          acceptInvalidCerts: event.target.checked,
                        }))
                      }
                    />
                    <span>接受无效证书（不安全）</span>
                  </label>
                </div>
              )}
            </div>
            <footer>
              <button onClick={() => setNewProfileOpen(false)}>取消</button>
              <button
                className="primary"
                disabled={profileAction === "new-profile"}
                onClick={() => void submitNewProfile()}
              >
                {profileAction === "new-profile" ? "导入中" : "保存"}
              </button>
            </footer>
          </div>
        </div>
      )}
      {connectionDetail && (
        <div
          className="clash-modal-backdrop"
          role="presentation"
          onMouseDown={() => setConnectionDetail(null)}
        >
          <div
            className="clash-modal connection-detail-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h3>{connectionDetail.host}</h3>
                <small>
                  {connectionDetail.closedAt
                    ? `已于 ${new Date(connectionDetail.closedAt).toLocaleString("zh-CN")} 关闭`
                    : "活动连接"}
                </small>
              </div>
              <button onClick={() => setConnectionDetail(null)}>×</button>
            </header>
            <dl>
              <div>
                <dt>源地址</dt>
                <dd>
                  {connectionDetail.sourceIp || "-"}:
                  {connectionDetail.sourcePort || "-"}
                </dd>
              </div>
              <div>
                <dt>目标地址</dt>
                <dd>
                  {connectionDetail.destinationIp || "-"}:
                  {connectionDetail.destinationPort || "-"}
                </dd>
              </div>
              <div>
                <dt>网络</dt>
                <dd>
                  {connectionDetail.network || "-"} ·{" "}
                  {connectionDetail.connectionType || "-"}
                </dd>
              </div>
              <div>
                <dt>进程</dt>
                <dd>{connectionDetail.process || "-"}</dd>
              </div>
              <div className="wide">
                <dt>进程路径</dt>
                <dd>{connectionDetail.processPath || "-"}</dd>
              </div>
              <div>
                <dt>匹配规则</dt>
                <dd>{connectionDetail.rule || "-"}</dd>
              </div>
              <div>
                <dt>规则内容</dt>
                <dd>{connectionDetail.rulePayload || "-"}</dd>
              </div>
              <div className="wide">
                <dt>代理链</dt>
                <dd>{connectionDetail.chains.join(" → ") || "DIRECT"}</dd>
              </div>
              <div>
                <dt>实时速度</dt>
                <dd>
                  ↓ {formatBytes(connectionDetail.downloadRate, true)}　↑{" "}
                  {formatBytes(connectionDetail.uploadRate, true)}
                </dd>
              </div>
              <div>
                <dt>累计流量</dt>
                <dd>
                  ↓ {formatBytes(connectionDetail.download)}　↑{" "}
                  {formatBytes(connectionDetail.upload)}
                </dd>
              </div>
              <div className="wide">
                <dt>开始时间</dt>
                <dd>
                  {connectionDetail.startedAt
                    ? new Date(connectionDetail.startedAt).toLocaleString(
                        "zh-CN",
                      )
                    : "-"}
                </dd>
              </div>
            </dl>
            <footer>
              <button onClick={() => setConnectionDetail(null)}>关闭</button>
              {!connectionDetail.closedAt && (
                <button
                  className="danger"
                  onClick={() => {
                    void closeConnection(connectionDetail.id);
                    setConnectionDetail(null);
                  }}
                >
                  终止连接
                </button>
              )}
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
