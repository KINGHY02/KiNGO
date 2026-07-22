import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ApartmentOutlined,
  CheckCircleOutlined,
  CloudDownloadOutlined,
  CloudOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  DisconnectOutlined,
  EnvironmentOutlined,
  ExclamationCircleOutlined,
  FieldTimeOutlined,
  FileTextOutlined,
  GithubOutlined,
  HeartOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  LeftOutlined,
  MoonOutlined,
  NodeIndexOutlined,
  PoweroffOutlined,
  ProfileOutlined,
  ReloadOutlined,
  RightOutlined,
  RollbackOutlined,
  SettingOutlined,
  SwapOutlined,
  SunOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import "./App.css";
import { ClashWorkspace, type ClashConnection, type ClashPage, type ClashRealtimeChannels } from "./ClashWorkspace";
import { V2rayWorkspace } from "./V2rayWorkspace";
import kingoLogo from "./assets/kingo-logo.png";

type Mode = "auto" | "clash" | "v2ray";
type Theme = "light" | "dark" | "pink" | "blue";
type Page =
  | "home"
  | "routes"
  | "proxy"
  | "subscriptions"
  | "groups"
  | "tests"
  | "connections"
  | "rules"
  | "logs"
  | "help"
  | "about"
  | "settings";
export type AppState = {
  mode: Mode;
  connected: boolean;
  connecting: boolean;
  stage: string;
  coreId: string | null;
  displayName: string | null;
  latency: number | null;
  exitIp: string | null;
  country: string | null;
  error: string | null;
  downloadBps: number;
  uploadBps: number;
  downloadTotal: number;
  uploadTotal: number;
  autoFailover: boolean;
  tunEnabled: boolean;
  systemProxyEnabled: boolean;
};
type Route = {
  id: string;
  name: string;
  protocolLabel: string;
  coreId: string;
  slot: number;
  downloaded: boolean;
  active: boolean;
  connectionState: string;
  lastSuccessAt: number | null;
  lastError: string | null;
  latency: number | null;
  country: string | null;
};
type LogEntry = { at: string; level: string; message: string };
type ClashTrafficEvent = { uploadBps: number; downloadBps: number };
type ClashConnectionsEvent = { connections: ClashConnection[]; uploadTotal: number; downloadTotal: number };
type ClashRealtimeStatusEvent = { channel: keyof ClashRealtimeChannels; connected: boolean; error: string | null };
type RouteProgress = {
  completed: number;
  total: number;
  routeId: string;
  routeName: string;
  latency: number | null;
  error: string | null;
};
type RouteTestSummary = {
  cancelled: boolean;
  succeeded: number;
  total: number;
};
type RouteUpdateProgress = {
  completed: number;
  total: number;
  routeId: string;
  routeName: string;
  success: boolean;
  error: string | null;
};
type RouteUpdateSummary = {
  success: boolean;
  cancelled: boolean;
  updated: number;
  failed: number;
  errors: { routeId: string; message: string }[];
};
type CoreVersionInfo = {
  coreId: string;
  name: string;
  currentVersion: string | null;
  latestVersion: string | null;
  outdated: boolean;
  source: "user" | "bundled" | "missing";
  available: boolean;
  updateSupported: boolean;
  assetName: string | null;
  assetSize: number | null;
  error: string | null;
};
type AppUpdateInfo = { currentVersion: string; latestVersion: string | null; outdated: boolean; releaseUrl: string };
type SpeedTestSettings = { url: string; timeoutSeconds: number; concurrency: number };
type V2raySettings = {
  localPort: number;
  allowLan: boolean;
  systemProxy: boolean;
  bypassLan: boolean;
  routingMode: "global" | "bypass-cn" | "direct";
  logLevel: "debug" | "info" | "warning" | "error";
  subscriptionUpdateMinutes: number;
  latencyTestUrl: string;
  speedTestUrl: string;
  ipInfoUrl: string;
  udpTestTarget: string;
  speedTestTimeoutSeconds: number;
  mixedConcurrency: number;
  tunEnabled: boolean;
  tunStack: "system" | "gvisor" | "mixed";
  tunMtu: number;
  tunStrictRoute: boolean;
  tunIpv6: boolean;
  tunRouteExclude: string[];
};

const labels: Record<Mode, string> = {
  auto: "全自动",
  clash: "Clash",
  v2ray: "V2ray",
};
const emptyState: AppState = {
  mode: "auto",
  connected: false,
  connecting: false,
  stage: "idle",
  coreId: null,
  displayName: null,
  latency: null,
  exitIp: null,
  country: null,
  error: null,
  downloadBps: 0,
  uploadBps: 0,
  downloadTotal: 0,
  uploadTotal: 0,
  autoFailover: false,
  tunEnabled: false,
  systemProxyEnabled: false,
};

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

function formatRouteTime(timestamp: number) {
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (elapsed < 60) return "刚刚";
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)} 分钟前`;
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)} 小时前`;
  return new Date(timestamp * 1000).toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });
}

function routeDescription(route: Route, selected: boolean) {
  if (route.active) return `正在使用 · ${route.protocolLabel}`;
  if (route.lastError) return route.lastError;
  if (selected)
    return route.lastSuccessAt
      ? `当前选中 · 最近可用 ${formatRouteTime(route.lastSuccessAt)}`
      : "当前选中 · 等待测速";
  if (route.lastSuccessAt)
    return `最近可用 ${formatRouteTime(route.lastSuccessAt)} · 配置就绪`;
  return route.downloaded
    ? `${route.protocolLabel} · 配置就绪，尚未测速`
    : `${route.protocolLabel} · 配置未就绪`;
}

function routeDisplayName(route: Route) {
  const country = route.country?.split(" · ")[0] ?? "未知地区";
  const number = route.name.match(/\d+/)?.[0];
  return number ? `${country} ${number}` : country;
}

function latencyColor(latency: number | null, failed: boolean) {
  if (failed) return "#dc4c4c";
  if (latency == null) return "#8a95a8";
  const ratio = Math.min(1, Math.max(0, (latency - 250) / 1250));
  const hue = Math.round(125 * (1 - ratio));
  return `hsl(${hue} 68% 40%)`;
}

type TrafficPoint = { up: number; down: number };

function TrafficChart({
  up,
  down,
  connected,
}: {
  up: number;
  down: number;
  connected: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<TrafficPoint[]>(
    Array.from({ length: 32 }, () => ({ up: 0, down: 0 })),
  );
  useEffect(() => {
    pointsRef.current.push(connected ? { up, down } : { up: 0, down: 0 });
    if (pointsRef.current.length > 32) pointsRef.current.shift();
  }, [up, down, connected]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let frame = 0;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.clearRect(0, 0, width, height);
      const points = pointsRef.current;
      const peak = Math.max(
        1024,
        ...points.flatMap((point) => [point.up, point.down]),
      );
      const step = width / Math.max(1, points.length - 1);
      const y = (value: number) =>
        height -
        3 -
        (Math.log10(value + 1) / Math.log10(peak + 1)) * (height - 10);
      context.lineWidth = ratio;
      context.strokeStyle = "rgba(130,145,175,.22)";
      for (const level of [0.33, 0.66]) {
        context.beginPath();
        context.moveTo(0, height * level);
        context.lineTo(width, height * level);
        context.stroke();
      }
      const line = (key: keyof TrafficPoint, color: string) => {
        context.beginPath();
        context.lineWidth = 2.2 * ratio;
        context.strokeStyle = color;
        context.lineJoin = "round";
        context.lineCap = "round";
        points.forEach((point, index) => {
          const x = index * step;
          const py = y(point[key]);
          if (index === 0) context.moveTo(x, py);
          else
            context.quadraticCurveTo(
              x - step / 2,
              y(points[index - 1][key]),
              x,
              py,
            );
        });
        context.stroke();
      };
      line("down", "#19b976");
      line("up", "#5974f3");
    };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    });
    observer.observe(canvas);
    frame = requestAnimationFrame(draw);
    const timer = window.setInterval(() => {
      frame = requestAnimationFrame(draw);
    }, 1000);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div
      className="chart"
      style={{
        position: "relative",
        display: "block",
        padding: 0,
        borderBottom: 0,
        overflow: "hidden",
        borderRadius: 10,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
        aria-label="实时上传下载流量曲线"
      />
    </div>
  );
}

function App() {
  const [mode, setMode] = useState<Mode>("auto");
  const [page, setPage] = useState<Page>("home");
  const [state, setState] = useState<AppState>(emptyState);
  const [routeId, setRouteId] = useState<string | null>(
    () => localStorage.getItem("kingo-auto-route") || null,
  );
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [clashConnections, setClashConnections] = useState<ClashConnection[]>([]);
  const [clashRealtimeChannels, setClashRealtimeChannels] = useState<ClashRealtimeChannels>({ traffic: false, connections: false, logs: false });
  const [appVersion, setAppVersion] = useState("2.0.0");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(() => localStorage.getItem("kingo-motion") !== "off");
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("kingo-theme") as Theme) || "light");
  const themeLabels: Record<Theme, string> = { light: "亮色", dark: "暗色", pink: "樱花粉", blue: "冰川蓝" };
  const switchTheme = () => { const themes: Theme[] = ["light", "dark", "pink", "blue"]; const next = themes[(themes.indexOf(theme) + 1) % themes.length]; setTheme(next); localStorage.setItem("kingo-theme", next); };

  useEffect(() => {
    void getVersion().then(setAppVersion).catch(() => undefined);
  }, []);

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    void Promise.all([
      listen<ClashTrafficEvent>("clash-realtime-traffic", (event) => {
        setState((current) => current.mode === "clash"
          ? { ...current, uploadBps: event.payload.uploadBps, downloadBps: event.payload.downloadBps }
          : current);
      }),
      listen<ClashConnectionsEvent>("clash-realtime-connections", (event) => {
        setClashConnections(event.payload.connections);
        setState((current) => current.mode === "clash"
          ? { ...current, uploadTotal: event.payload.uploadTotal, downloadTotal: event.payload.downloadTotal }
          : current);
      }),
      listen<ClashRealtimeStatusEvent>("clash-realtime-status", (event) => {
        setClashRealtimeChannels((current) => ({ ...current, [event.payload.channel]: event.payload.connected }));
        if (event.payload.channel === "connections" && !event.payload.connected) {
          void invoke<ClashConnection[]>("list_clash_connections").then(setClashConnections).catch(() => undefined);
        }
      }),
    ]).then((values) => cleanups.push(...values));
    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);

  const clashRealtimeActive = state.connected && state.mode === "clash" && state.coreId === "mihomo";

  useEffect(() => {
    if (clashRealtimeActive) {
      void invoke<ClashConnection[]>("list_clash_connections").then(setClashConnections).catch(() => undefined);
      void invoke("start_clash_realtime").catch((error) => {
        setState((current) => ({ ...current, error: String(error) }));
        void invoke<ClashConnection[]>("list_clash_connections").then(setClashConnections).catch(() => undefined);
      });
      return () => { void invoke("stop_clash_realtime"); };
    }
    setClashConnections([]);
    setClashRealtimeChannels({ traffic: false, connections: false, logs: false });
    void invoke("stop_clash_realtime").catch(() => undefined);
  }, [clashRealtimeActive]);

  useEffect(() => {
    void invoke<AppState>("get_app_state")
      .then(setState)
      .catch(() => undefined);
    void invoke("select_public_route", { routeId }).catch(() => undefined);
    let cleanup: (() => void) | undefined;
    void listen<AppState>("connection-state", (event) =>
      setState(event.payload),
    ).then((value) => {
      cleanup = value;
    });
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void listen<{ level: string; message: string }>(
      "connection-log",
      (event) => {
        const entry = { ...event.payload, at: new Date().toLocaleTimeString() };
        setLogs((items) => {
          const previous = items[items.length - 1];
          return previous?.level === entry.level && previous.message === entry.message
            ? items
            : [...items.slice(-99), entry];
        });
      },
    ).then((value) => {
      cleanup = value;
    });
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void listen<string | null>("public-route-selection", (event) => {
      const value = event.payload;
      setRouteId(value);
      if (value) localStorage.setItem("kingo-auto-route", value);
      else localStorage.removeItem("kingo-auto-route");
    }).then((value) => {
      cleanup = value;
    });
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    if (!state.connected || (state.mode === "clash" && state.coreId === "mihomo")) return;
    const timer = window.setInterval(() => {
      void invoke("get_traffic").catch(() => undefined);
    }, 1000);
    void invoke("get_traffic").catch(() => undefined);
    return () => window.clearInterval(timer);
  }, [state.connected, state.mode, state.coreId]);

  async function chooseRoute(id: string) {
    const value = id || null;
    const previous = routeId;
    setRouteId(value);
    if (value) localStorage.setItem("kingo-auto-route", value);
    else localStorage.removeItem("kingo-auto-route");
    try {
      if (state.connected && state.mode === "auto") {
        await invoke("start_public_connection", { routeId: value });
      } else {
        await invoke("select_public_route", { routeId: value });
      }
    } catch (error) {
      setRouteId(previous);
      if (previous) localStorage.setItem("kingo-auto-route", previous);
      else localStorage.removeItem("kingo-auto-route");
      void invoke("select_public_route", { routeId: previous }).catch(() => undefined);
      setState((current) => ({ ...current, error: String(error) }));
    }
  }

  const nav = useMemo(() => {
    if (mode === "auto")
      return [
        ["home", "首页", <DashboardOutlined />],
        ["routes", "线路", <CloudServerOutlined />],
        ["logs", "日志", <FileTextOutlined />],
        ["settings", "设置", <SettingOutlined />],
      ] as const;
    if (mode === "clash")
      return [
        ["home", "首页", <DashboardOutlined />],
        ["proxy", "代理", <ApartmentOutlined />],
        ["subscriptions", "订阅", <ProfileOutlined />],
        ["connections", "连接", <SwapOutlined />],
        ["rules", "规则", <NodeIndexOutlined />],
        ["logs", "日志", <FileTextOutlined />],
        ["tests", "测试", <FieldTimeOutlined />],
        ["settings", "设置", <SettingOutlined />],
      ] as const;
    return [
      ["home", "配置项", <ProfileOutlined />],
      ["subscriptions", "订阅分组", <CloudDownloadOutlined />],
      ["settings", "设置", <SettingOutlined />],
      ["help", "帮助", <InfoCircleOutlined />],
      ["restart-v2ray", "重启服务", <ReloadOutlined />],
      ["about", "关于 KiNGO", <HeartOutlined />],
      ["close-window", "关闭", <DisconnectOutlined />],
    ] as const;
  }, [mode]);

  async function handleNav(id: string) {
    if (mode === "v2ray" && id === "restart-v2ray") {
      try {
        if (state.mode !== "v2ray" || (!state.connected && !state.connecting)) {
          throw new Error("请先选择节点并启动 V2ray 服务");
        }
        await invoke("stop_v2ray_connection");
        await invoke("start_v2ray_connection", { nodeId: null });
        setPage("home");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setState((current) => ({ ...current, error: message }));
      }
      return;
    }
    if (mode === "v2ray" && id === "close-window") {
      await getCurrentWindow().hide();
      return;
    }
    setPage(id as Page);
  }

  async function connectToggle() {
    if ((state.connected || state.connecting) && state.mode !== "auto") {
      setState((value) => ({ ...value, error: `${labels[state.mode as Mode]} 模式正在运行，请先在对应模式中断开连接` }));
      return;
    }
    const command = state.connecting
      ? "cancel_connection"
      : state.connected
        ? "disconnect"
        : "start_public_connection";
    try {
      if (command === "start_public_connection")
        await invoke(command, { routeId });
      else await invoke(command);
    } catch (error) {
      setState((value) => ({
        ...value,
        error: String(error),
        connecting: false,
      }));
    }
  }

  const autoViewState: AppState = state.mode === "auto"
    ? state
    : {
        ...emptyState,
        autoFailover: state.autoFailover,
        error: state.connected || state.connecting
          ? `${labels[state.mode as Mode]} 模式正在${state.connecting ? "连接" : "运行"}，全自动模式当前未接管系统代理`
          : null,
      };

  async function refreshExit() {
    try {
      await invoke("refresh_exit_info");
    } catch (error) {
      setState((value) => ({ ...value, error: String(error) }));
    }
  }

  return (
    <div className={`app-shell theme-${theme}${motionEnabled ? "" : " motion-off"}`}>
      <aside className={sidebarCollapsed ? "sidebar collapsed" : "sidebar"}>
        <div className="brand">
          <img className="brand-logo" src={kingoLogo} alt="KiNGO" />
          <span>KiNGO</span>
        </div>
        <div className="mode-switch">
          {(Object.keys(labels) as Mode[]).map((item) => (
            <button
              key={item}
              className={mode === item ? "mode active" : "mode"}
              onClick={() => {
                setMode(item);
                setPage("home");
              }}
            >
            <span className="mode-full">{labels[item]}</span><span className="mode-short">{item === "auto" ? "自" : item === "clash" ? "C" : "V"}</span>
            </button>
          ))}
        </div>
        <nav className="nav">
          {nav.map(([id, label, icon]) => (
            <button
              key={id}
              className={page === id ? "nav-item selected" : "nav-item"}
              onClick={() => void handleNav(id)}
            >
              <span>{icon}</span>
              <span className="nav-label">{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-controls"><button className="icon-button theme-button" aria-label={`当前${themeLabels[theme]}主题，点击切换`} title={`当前：${themeLabels[theme]}主题`} onClick={switchTheme}>{theme === "light" ? <SunOutlined /> : theme === "dark" ? <MoonOutlined /> : theme === "pink" ? <HeartOutlined /> : <CloudOutlined />}</button><button className="icon-button collapse-button" aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"} title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"} onClick={() => setSidebarCollapsed(value => !value)}>{sidebarCollapsed ? <RightOutlined /> : <LeftOutlined />}</button></div>
          <span className="version">v{appVersion}</span>
        </div>
      </aside>
      <main className={mode === "v2ray" && page === "home" ? "content v2ray-main-content" : "content"}>
        <header className="topbar">
          <div>
            <h1>
              {mode === "v2ray"
                ? (nav.find((item) => item[0] === page)?.[1] ?? "配置项")
                : page === "home"
                ? "首页"
                : (nav.find((item) => item[0] === page)?.[1] ?? "KiNGO")}
            </h1>
          </div>
          <span className="proxy-badge">
            {mode === "v2ray"
              ? state.mode === "v2ray" && state.connected
                ? "V2ray 服务已连接"
                : state.mode === "v2ray" && state.connecting
                  ? "V2ray 服务启动中"
                  : state.mode !== "v2ray" && (state.connected || state.connecting)
                    ? `${labels[state.mode as Mode]} 模式运行中`
                    : "V2ray 服务未启动"
              : mode === "auto" && state.mode !== "auto" && (state.connected || state.connecting)
                ? `${labels[state.mode as Mode]} 模式运行中`
                : state.connected ? "系统代理已开启" : "系统代理未开启"}
          </span>
        </header>
        {mode === "v2ray" && page !== "settings" ? (
          <V2rayWorkspace
            view={page === "subscriptions" ? "subscriptions" : page === "help" ? "help" : page === "about" ? "about" : "profiles"}
            state={state}
            logs={logs}
          />
        ) : mode === "clash" ? (
          <ClashWorkspace
            page={page as ClashPage}
            state={state}
            logs={logs}
            connections={clashConnections}
            realtime={clashRealtimeChannels}
            onPage={(value) => setPage(value as Page)}
          />
        ) : page === "home" ? (
          mode === "auto" ? (
            <Home
              state={autoViewState}
              onToggle={connectToggle}
              onRefresh={refreshExit}
              onNavigate={setPage}
            />
          ) : (
            <ModeHome mode={mode} state={state} onNavigate={setPage} />
          )
        ) : (
          <Workspace
            mode={mode}
            page={page}
            state={state}
            logs={logs}
            routeId={routeId}
            onRoute={chooseRoute}
            onPage={setPage}
            motionEnabled={motionEnabled}
            onMotionEnabled={(enabled) => { setMotionEnabled(enabled); localStorage.setItem("kingo-motion", enabled ? "on" : "off"); }}
          />
        )}
      </main>
    </div>
  );
}

function Home({
  state,
  onToggle,
  onRefresh,
  onNavigate,
}: {
  state: AppState;
  onToggle: () => void;
  onRefresh: () => void;
  onNavigate: (page: Page) => void;
}) {
  const button = state.connecting
    ? state.stage === "switching" ? "正在切换" : "正在连接"
    : state.connected
      ? "断开连接"
      : "一键连接";
  const title = state.connecting
    ? (state.displayName ?? (state.stage === "switching" ? "正在切换线路" : "正在准备连接"))
    : state.connected
      ? state.displayName
      : state.error
        ? "连接失败"
        : "未连接";
  return (
    <div className="page home-page">
      <section className="hero-card auto-hero-card">
        <div
          className={
            state.connecting
              ? "connect-ring testing"
              : state.connected
                ? "connect-ring connected"
                : "connect-ring"
          }
        >
          <button className="connect-button" onClick={onToggle}>
            <span className="power">
              {state.connecting ? (
                <LoadingOutlined spin />
              ) : state.connected ? (
                <DisconnectOutlined />
              ) : (
                <PoweroffOutlined />
              )}
            </span>
            <strong>{button}</strong>
            <small>
              {state.connecting
                ? state.stage === "switching" ? "正在验证新线路 · 点击取消" : "点击取消"
                : state.connected
                  ? (state.displayName ?? "公共线路")
                  : "自动选择公共线路"}
            </small>
          </button>
        </div>
        <div className="hero-info">
          <div className="eyebrow">
            <span
              className={
                state.connected
                  ? "pill success"
                  : state.error
                    ? "pill error"
                    : "pill"
              }
            >
              {state.connected
                ? "已连接"
                : state.error
                  ? "连接失败"
                  : state.connecting
                    ? state.stage === "switching" ? "正在切换" : "正在连接"
                    : "待连接"}
            </span>
            <span className="pill">全自动</span>
          </div>
          <h2>{title}</h2>
          <p className="muted">
            {state.error ?? (state.connected ? "公共线路 · 连接已建立" : "")}
          </p>
          <div className="metrics">
            <span>
              <FieldTimeOutlined /> 延迟：
              {state.latency ? `${state.latency}ms` : "未测试"}
            </span>
            <span>
              <EnvironmentOutlined /> 地区：{state.country ?? "-"}
            </span>
            <span>IP：{state.exitIp ?? "-"}</span>
          </div>
          <div className="small-actions">
            <button onClick={() => onNavigate("connections")}>连接详情</button>
            <button
              onClick={onRefresh}
              disabled={!state.connected || state.connecting}
            >
              刷新出口 IP
            </button>
            <button onClick={() => onNavigate("routes")}>选择线路</button>
          </div>
        </div>
      </section>
      <section className="traffic-card">
        <div className="section-title">
          <span>流量统计</span>
          <b>{state.connected ? "当前 KiNGO 连接" : "暂无连接数据"}</b>
        </div>
        <div className="traffic-values">
          <div>
            <small>下载</small>
            <strong className="download">
              {formatBytes(state.downloadBps, true)}
            </strong>
            <small>累计 {formatBytes(state.downloadTotal)}</small>
          </div>
          <div>
            <small>上传</small>
            <strong className="upload">
              {formatBytes(state.uploadBps, true)}
            </strong>
            <small>累计 {formatBytes(state.uploadTotal)}</small>
          </div>
          <TrafficChart
            up={state.uploadBps}
            down={state.downloadBps}
            connected={state.connected}
          />
        </div>
      </section>
    </div>
  );
}

function ModeHome({
  mode,
  state,
  onNavigate,
}: {
  mode: Exclude<Mode, "auto">;
  state: AppState;
  onNavigate: (page: Page) => void;
}) {
  const clash = mode === "clash";
  const title = clash ? "Clash 控制中心" : "V2ray 控制中心";
  const subtitle = clash
    ? "管理 Mihomo 订阅、代理组和活动连接"
    : "管理 Xray / sing-box 节点、分组和测速";
  const cards: {
    page: Page;
    icon: string;
    title: string;
    description: string;
  }[] = clash
    ? [
        {
          page: "proxy",
          icon: "◈",
          title: "代理",
          description: "查看并切换 Mihomo 代理组",
        },
        {
          page: "subscriptions",
          icon: "▣",
          title: "订阅",
          description: "管理 Clash 订阅与配置",
        },
        {
          page: "connections",
          icon: "↔",
          title: "连接",
          description: "查看当前活动连接",
        },
      ]
    : [
        {
          page: "groups",
          icon: "▦",
          title: "分组与节点",
          description: "管理 Xray / sing-box 节点",
        },
        {
          page: "tests",
          icon: "◉",
          title: "测速",
          description: "测试节点延迟与可用性",
        },
        {
          page: "connections",
          icon: "↔",
          title: "连接",
          description: "查看当前核心连接状态",
        },
      ];
  return (
    <div className="page mode-home-page">
      <section className={`mode-hero ${clash ? "clash-hero" : "v2ray-hero"}`}>
        <div>
          <span className="mode-kicker">
            {clash ? "MIHOMO" : "XRAY · SING-BOX"}
          </span>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div
          className={state.connected ? "mode-state connected" : "mode-state"}
        >
          <i />
          {state.connected
            ? `已连接 · ${state.displayName ?? "运行中"}`
            : "当前未连接"}
        </div>
      </section>
      <section className="mode-action-grid">
        {cards.map((card) => (
          <button
            className="mode-action-card"
            key={card.page}
            onClick={() => onNavigate(card.page)}
          >
            <span>{card.icon}</span>
            <div>
              <b>{card.title}</b>
              <small>{card.description}</small>
            </div>
            <em>进入</em>
          </button>
        ))}
      </section>
      <section className="mode-note">
        <b>{clash ? "Clash 工作区" : "V2ray 工作区"}</b>
        <p>
          该模式与全自动公共线路相互独立，具体功能请从上方入口或左侧导航进入。
        </p>
      </section>
    </div>
  );
}

function Workspace({
  mode,
  page,
  state,
  logs,
  routeId,
  onRoute,
  onPage,
  motionEnabled,
  onMotionEnabled,
}: {
  mode: Mode;
  page: Page;
  state: AppState;
  logs: LogEntry[];
  routeId: string | null;
  onRoute: (id: string) => void;
  onPage: (page: Page) => void;
  motionEnabled: boolean;
  onMotionEnabled: (enabled: boolean) => void;
}) {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [progress, setProgress] = useState<RouteProgress | null>(null);
  const [testSummary, setTestSummary] = useState<RouteTestSummary | null>(null);
  const [updateProgress, setUpdateProgress] =
    useState<RouteUpdateProgress | null>(null);
  const [updateSummary, setUpdateSummary] = useState<RouteUpdateSummary | null>(
    null,
  );
  const [coreVersions, setCoreVersions] = useState<CoreVersionInfo[]>([]);
  const [checkingCores, setCheckingCores] = useState(false);
  const [updatingCore, setUpdatingCore] = useState<string | null>(null);
  const [coreMessage, setCoreMessage] = useState<string | null>(null);
  const [appUpdate, setAppUpdate] = useState<AppUpdateInfo | null>(null);
  const [checkingAppUpdate, setCheckingAppUpdate] = useState(false);
  const [appUpdateError, setAppUpdateError] = useState<string | null>(null);
  const [speedSettings, setSpeedSettings] = useState<SpeedTestSettings>({ url: "https://www.gstatic.com/generate_204", timeoutSeconds: 4, concurrency: 6 });
  const [speedSettingsMessage, setSpeedSettingsMessage] = useState<string | null>(null);
  const [v2raySettings, setV2raySettings] = useState<V2raySettings>({ localPort: 10808, allowLan: false, systemProxy: true, bypassLan: true, routingMode: "bypass-cn", logLevel: "warning", subscriptionUpdateMinutes: 0, latencyTestUrl: "https://www.gstatic.com/generate_204", speedTestUrl: "https://speed.cloudflare.com/__down?bytes=10000000", ipInfoUrl: "https://api.ip.sb/geoip", udpTestTarget: "1.1.1.1:53", speedTestTimeoutSeconds: 15, mixedConcurrency: 5, tunEnabled: false, tunStack: "system", tunMtu: 1500, tunStrictRoute: true, tunIpv6: false, tunRouteExclude: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"] });
  const [v2raySettingsMessage, setV2raySettingsMessage] = useState<string | null>(null);
  const [loopbackMessage, setLoopbackMessage] = useState<string | null>(null);
  useEffect(() => {
    if (page !== "settings") return;
    void invoke<SpeedTestSettings>("get_speed_test_settings").then(setSpeedSettings).catch(() => undefined);
  }, [page]);
  useEffect(() => {
    if (page !== "settings" || mode !== "v2ray") return;
    void invoke<V2raySettings>("get_v2ray_settings").then(setV2raySettings).catch((error) => setV2raySettingsMessage(String(error)));
  }, [mode, page]);
  useEffect(() => {
    if (mode !== "auto") return;
    void invoke<Route[]>("list_public_routes")
      .then(setRoutes)
      .catch(() => setRoutes([]));
    void invoke<RouteUpdateProgress | null>("get_public_route_update_status")
      .then(setUpdateProgress)
      .catch(() => undefined);
  }, [mode]);
  useEffect(() => {
    if (mode !== "auto") return;
    void invoke<Route[]>("list_public_routes")
      .then(setRoutes)
      .catch(() => undefined);
  }, [mode, state.mode, state.connected, state.connecting, state.stage, state.displayName]);
  useEffect(() => {
    if (mode !== "auto") return;
    let cleanup: (() => void) | undefined;
    void listen<RouteProgress>("public-route-progress", (event) => {
      setProgress(event.payload);
      void invoke<Route[]>("list_public_routes")
        .then(setRoutes)
        .catch(() => undefined);
    }).then((value) => {
      cleanup = value;
    });
    return () => cleanup?.();
  }, [mode]);
  useEffect(() => {
    if (mode !== "auto") return;
    let cleanup: (() => void) | undefined;
    void listen<RouteTestSummary>("public-route-test-complete", (event) => {
      setTestSummary(event.payload);
      setProgress(null);
      void invoke<Route[]>("list_public_routes")
        .then(setRoutes)
        .catch(() => undefined);
    }).then((value) => {
      cleanup = value;
    });
    return () => cleanup?.();
  }, [mode]);
  useEffect(() => {
    if (mode !== "auto") return;
    let cleanupProgress: (() => void) | undefined;
    let cleanupComplete: (() => void) | undefined;
    void listen<RouteUpdateProgress>(
      "public-route-update-progress",
      (event) => {
        setUpdateProgress(event.payload);
      },
    ).then((value) => {
      cleanupProgress = value;
    });
    void listen<RouteUpdateSummary>("public-route-update-complete", (event) => {
      setUpdateSummary(event.payload);
      setUpdateProgress(null);
      void invoke<Route[]>("list_public_routes")
        .then(setRoutes)
        .catch(() => undefined);
    }).then((value) => {
      cleanupComplete = value;
    });
    return () => {
      cleanupProgress?.();
      cleanupComplete?.();
    };
  }, [mode]);
  const selectedRoute = routes.find((route) => route.id === routeId);
  const selectedRouteName =
    routeId == null
      ? "自动选择最近可用线路"
      : selectedRoute
        ? routeDisplayName(selectedRoute)
        : "指定线路";
  const ownsConnection = state.mode === mode;
  const checkCoreUpdates = async () => {
    setCheckingCores(true);
    setCoreMessage(null);
    try {
      setCoreVersions(await invoke<CoreVersionInfo[]>("check_core_updates"));
    } catch (error) {
      setCoreMessage(`检查核心更新失败：${String(error)}`);
    } finally {
      setCheckingCores(false);
    }
  };
  const installCoreUpdate = async (core: CoreVersionInfo) => {
    if (
      !window.confirm(
        `更新 ${core.name} 到 ${core.latestVersion ?? "最新版本"}？\n更新时会停止当前代理核心。`,
      )
    )
      return;
    setUpdatingCore(core.coreId);
    setCoreMessage(`正在下载并安装 ${core.name}…`);
    try {
      const result = await invoke<{
        version: string;
        checksumVerified: boolean;
      }>("update_core", { coreId: core.coreId });
      setCoreMessage(
        `${core.name} 已更新至 ${result.version}${result.checksumVerified ? "，SHA-256 校验通过" : ""}`,
      );
      await checkCoreUpdates();
    } catch (error) {
      setCoreMessage(`${core.name} 更新失败：${String(error)}`);
    } finally {
      setUpdatingCore(null);
    }
  };
  const restoreCore = async (core: CoreVersionInfo) => {
    if (!window.confirm(`恢复 ${core.name} 的内置版本？用户更新版将被删除。`))
      return;
    setUpdatingCore(core.coreId);
    try {
      await invoke("restore_bundled_core", { coreId: core.coreId });
      setCoreMessage(`${core.name} 已恢复为内置版本`);
      await checkCoreUpdates();
    } catch (error) {
      setCoreMessage(`${core.name} 恢复失败：${String(error)}`);
    } finally {
      setUpdatingCore(null);
    }
  };
  const checkAppUpdate = async () => {
    setCheckingAppUpdate(true);
    setAppUpdateError(null);
    try { setAppUpdate(await invoke<AppUpdateInfo>("check_app_update")); }
    catch (error) { setAppUpdateError(`检查软件更新失败：${String(error)}`); }
    finally { setCheckingAppUpdate(false); }
  };
  const saveSpeedSettings = async (settings = speedSettings) => {
    setSpeedSettingsMessage(null);
    try { const saved = await invoke<SpeedTestSettings>("set_speed_test_settings", { settings }); setSpeedSettings(saved); setSpeedSettingsMessage("测速设置已保存"); }
    catch (error) { setSpeedSettingsMessage(`保存失败：${String(error)}`); }
  };
  const resetSpeedSettings = () => {
    const defaults = { url: "https://www.gstatic.com/generate_204", timeoutSeconds: 4, concurrency: 6 };
    setSpeedSettings(defaults); void saveSpeedSettings(defaults);
  };
  const saveV2raySettings = async () => {
    setV2raySettingsMessage(null);
    try {
      const saved = await invoke<V2raySettings>("set_v2ray_settings", { settings: v2raySettings });
      setV2raySettings(saved);
      setV2raySettingsMessage("V2ray 运行设置已保存，下次启动服务时生效");
    } catch (error) {
      setV2raySettingsMessage(`保存失败：${String(error)}`);
    }
  };
  const setupUwpLoopback = async () => {
    setLoopbackMessage("正在请求 Windows 管理员授权…");
    try {
      setLoopbackMessage(await invoke<string>("enable_uwp_loopback"));
    } catch (error) {
      setLoopbackMessage(`设置失败：${String(error)}`);
    }
  };
  if ((page as Page) === "settings")
    return (
      <div className="page workspace settings-page">
        <div className="settings-section">
          <div className="settings-section-heading"><div><b>界面与动效</b></div></div>
          <div className="settings-list">
            <section className="settings-card"><div><b>界面动效</b><p className="muted">开启轻微位移、颜色渐变和按压回弹；关闭后所有界面过渡立即停用。</p></div><button className={motionEnabled ? "toggle on" : "toggle"} onClick={() => onMotionEnabled(!motionEnabled)} aria-label="界面动效"><i /></button></section>
            <section className="settings-card"><div><b>Windows 应用代理兼容</b><p className="muted">解除 Microsoft Store 版 ChatGPT/OpenAI 应用访问本地代理的回环限制，与 Clash Verge、V2rayN 的处理方式一致。</p>{loopbackMessage && <small className="muted">{loopbackMessage}</small>}</div><button className="settings-action" onClick={() => void setupUwpLoopback()}>解除回环限制</button></section>
          </div>
        </div>
        {mode === "v2ray" && <div className="settings-section speed-settings-section">
          <div className="settings-section-heading"><div><b>V2ray 运行设置</b></div><div className="settings-heading-actions"><button className="settings-action primary-button" disabled={state.connected || state.connecting} onClick={() => void saveV2raySettings()}>保存设置</button></div></div>
          <div className="speed-settings-grid v2ray-settings-grid">
            <label><span>本地代理端口</span><input type="number" min="1024" max="65535" value={v2raySettings.localPort} onChange={(event) => setV2raySettings(value => ({ ...value, localPort: Number(event.target.value) }))}/><small>Xray 与 sing-box 统一使用此端口。</small></label>
            <label><span>路由模式</span><select value={v2raySettings.routingMode} onChange={(event) => setV2raySettings(value => ({ ...value, routingMode: event.target.value as V2raySettings["routingMode"] }))}><option value="bypass-cn">绕过大陆与局域网</option><option value="global">全局代理</option><option value="direct">全部直连</option></select><small>保存后重新启动服务生效。</small></label>
            <label><span>日志级别</span><select value={v2raySettings.logLevel} onChange={(event) => setV2raySettings(value => ({ ...value, logLevel: event.target.value as V2raySettings["logLevel"] }))}><option value="error">错误</option><option value="warning">警告</option><option value="info">信息</option><option value="debug">调试</option></select><small>调试级别会产生更多核心日志。</small></label>
            <label><span>订阅自动更新</span><select value={v2raySettings.subscriptionUpdateMinutes} onChange={(event) => setV2raySettings(value => ({ ...value, subscriptionUpdateMinutes: Number(event.target.value) }))}><option value="0">关闭</option><option value="15">每 15 分钟</option><option value="60">每小时</option><option value="360">每 6 小时</option><option value="720">每 12 小时</option><option value="1440">每天</option></select><small>仅更新已启用的订阅。</small></label>
          </div>
          <div className="settings-list v2ray-setting-toggles">
            <section className="settings-card"><div><b>接管系统代理</b><p className="muted">连接成功后自动设置 Windows 系统代理，断开时恢复。</p></div><button className={v2raySettings.systemProxy ? "toggle on" : "toggle"} onClick={() => setV2raySettings(value => ({ ...value, systemProxy: !value.systemProxy }))}><i /></button></section>
            <section className="settings-card"><div><b>允许局域网连接</b><p className="muted">监听 0.0.0.0，使同一局域网设备可使用本机代理端口。</p></div><button className={v2raySettings.allowLan ? "toggle on" : "toggle"} onClick={() => setV2raySettings(value => ({ ...value, allowLan: !value.allowLan }))}><i /></button></section>
            <section className="settings-card"><div><b>绕过局域网地址</b><p className="muted">私有地址保持直连，并写入系统代理绕过列表。</p></div><button className={v2raySettings.bypassLan ? "toggle on" : "toggle"} onClick={() => setV2raySettings(value => ({ ...value, bypassLan: !value.bypassLan }))}><i /></button></section>
          </div>
          <div className="settings-section-heading v2ray-test-settings-heading"><div><b>TUN 模式</b></div></div>
          <div className="settings-list v2ray-setting-toggles">
            <section className="settings-card"><div><b>接管全部应用流量</b><p className="muted">通过 sing-box 创建 kingo_tun 虚拟网卡，适用于 ChatGPT、Store 应用、游戏和不读取系统代理的软件。首次启动会请求管理员权限。</p></div><button className={v2raySettings.tunEnabled ? "toggle on" : "toggle"} onClick={() => setV2raySettings(value => ({ ...value, tunEnabled: !value.tunEnabled, systemProxy: value.tunEnabled ? value.systemProxy : false }))}><i /></button></section>
            <section className="settings-card"><div><b>严格路由与 DNS 防泄漏</b><p className="muted">阻止流量从其他网络接口绕过 TUN；可能影响 VirtualBox 等虚拟网络软件。</p></div><button className={v2raySettings.tunStrictRoute ? "toggle on" : "toggle"} onClick={() => setV2raySettings(value => ({ ...value, tunStrictRoute: !value.tunStrictRoute }))}><i /></button></section>
            <section className="settings-card"><div><b>TUN IPv6</b><p className="muted">同时接管 IPv6 流量；网络或节点不支持 IPv6 时建议关闭。</p></div><button className={v2raySettings.tunIpv6 ? "toggle on" : "toggle"} onClick={() => setV2raySettings(value => ({ ...value, tunIpv6: !value.tunIpv6 }))}><i /></button></section>
          </div>
          <div className="speed-settings-grid v2ray-settings-grid">
            <label><span>网络栈</span><select value={v2raySettings.tunStack} onChange={(event) => setV2raySettings(value => ({ ...value, tunStack: event.target.value as V2raySettings["tunStack"] }))}><option value="system">System（推荐）</option><option value="mixed">Mixed</option><option value="gvisor">gVisor</option></select><small>System性能最好；Mixed兼顾 UDP兼容；gVisor隔离性更强。</small></label>
            <label><span>MTU</span><select value={v2raySettings.tunMtu} onChange={(event) => setV2raySettings(value => ({ ...value, tunMtu: Number(event.target.value) }))}>{[1280, 1408, 1500, 4064, 9000].map(value => <option value={value} key={value}>{value}</option>)}</select><small>默认1500；移动网络或丢包时可尝试1280或1408。</small></label>
            <label className="speed-url-field"><span>路由排除网段</span><input value={v2raySettings.tunRouteExclude.join(", ")} onChange={(event) => setV2raySettings(value => ({ ...value, tunRouteExclude: event.target.value.split(/[;,\s]+/).filter(Boolean) }))}/><small>这些网段不进入 TUN，使用逗号分隔；默认排除局域网。</small></label>
          </div>
          <div className="settings-section-heading v2ray-test-settings-heading"><div><b>V2ray 测速设置</b></div></div>
          <div className="speed-settings-grid v2ray-settings-grid">
            <label className="speed-url-field"><span>真实延迟地址</span><input value={v2raySettings.latencyTestUrl} onChange={(event) => setV2raySettings(value => ({ ...value, latencyTestUrl: event.target.value }))}/><small>通过节点连续请求两次并取较低耗时。</small></label>
            <label className="speed-url-field"><span>下载测速地址</span><input value={v2raySettings.speedTestUrl} onChange={(event) => setV2raySettings(value => ({ ...value, speedTestUrl: event.target.value }))}/><small>默认下载 Cloudflare 10MB 测速内容，会消耗节点流量。</small></label>
            <label className="speed-url-field"><span>出口信息地址</span><input value={v2raySettings.ipInfoUrl} onChange={(event) => setV2raySettings(value => ({ ...value, ipInfoUrl: event.target.value }))}/><small>用于获取节点出口 IP 与国家信息。</small></label>
            <label><span>UDP 测试目标</span><input value={v2raySettings.udpTestTarget} onChange={(event) => setV2raySettings(value => ({ ...value, udpTestTarget: event.target.value }))}/><small>必须使用 IP:端口，例如 1.1.1.1:53。</small></label>
            <label><span>下载测速超时</span><select value={v2raySettings.speedTestTimeoutSeconds} onChange={(event) => setV2raySettings(value => ({ ...value, speedTestTimeoutSeconds: Number(event.target.value) }))}>{[5, 10, 15, 20, 30, 60, 120].map(value => <option value={value} key={value}>{value} 秒</option>)}</select><small>时间越长测速结果越稳定，但消耗流量更多。</small></label>
            <label><span>混合测速并发</span><select value={v2raySettings.mixedConcurrency} onChange={(event) => setV2raySettings(value => ({ ...value, mixedConcurrency: Number(event.target.value) }))}>{[1, 2, 3, 4, 5, 6, 8, 10, 12, 16].map(value => <option value={value} key={value}>{value} 个节点</option>)}</select><small>同时运行的临时核心数量，默认 5。</small></label>
          </div>
          {state.connected && <div className="settings-notice"><ExclamationCircleOutlined /> 请先断开 V2ray 服务再修改运行设置。</div>}
          {v2raySettingsMessage && <div className={v2raySettingsMessage.startsWith("保存失败") ? "settings-notice" : "settings-notice info"}>{v2raySettingsMessage}</div>}
        </div>}
        <div className="settings-section speed-settings-section">
          <div className="settings-section-heading"><div><b>测速设置</b></div><div className="settings-heading-actions"><button className="settings-action" onClick={resetSpeedSettings}>恢复默认</button><button className="settings-action primary-button" onClick={() => void saveSpeedSettings()}>保存设置</button></div></div>
          <div className="speed-settings-grid">
            <label className="speed-url-field"><span>测速 URL</span><input value={speedSettings.url} placeholder="https://www.gstatic.com/generate_204" onChange={(event) => setSpeedSettings(value => ({ ...value, url: event.target.value }))}/><small>支持 HTTP 或 HTTPS，建议使用返回快速且文件很小的 204 地址。</small></label>
            <label><span>超时时间</span><select value={speedSettings.timeoutSeconds} onChange={(event) => setSpeedSettings(value => ({ ...value, timeoutSeconds: Number(event.target.value) }))}>{[2, 3, 4, 5, 8, 10, 15, 20, 30].map(value => <option value={value} key={value}>{value} 秒</option>)}</select><small>包括代理连接和目标地址响应时间。</small></label>
            <label><span>并发数量</span><select value={speedSettings.concurrency} onChange={(event) => setSpeedSettings(value => ({ ...value, concurrency: Number(event.target.value) }))}>{[1, 2, 3, 4, 6, 8, 10, 12].map(value => <option value={value} key={value}>{value} 个任务</option>)}</select><small>并发越高测速越快，但会占用更多核心进程和网络资源。</small></label>
          </div>
          {speedSettingsMessage && <div className={speedSettingsMessage.startsWith("保存失败") ? "settings-notice" : "settings-notice info"}>{speedSettingsMessage}</div>}
        </div>
        <div className="settings-section">
          <div className="settings-section-heading">
            <div>
              <b>连接保护</b>
            </div>
          </div>
          <div className="settings-list">
            <section className="settings-card">
              <div>
                <b>线路故障自动切换</b>
                <p className="muted">
                  连续三次健康检查失败或核心退出后，自动尝试其他可用线路。
                </p>
              </div>
              <button
                className={state.autoFailover ? "toggle on" : "toggle"}
                onClick={() =>
                  void invoke("set_auto_failover", {
                    enabled: !state.autoFailover,
                  })
                }
                aria-label="线路故障自动切换"
              >
                <i />
              </button>
            </section>
            <section className="settings-card">
              <div>
                <b>系统代理保护</b>
                <p className="muted">
                  连接前备份 Windows 代理和 PAC 设置，断开或失败后自动恢复。
                </p>
              </div>
              <span
                className={
                  state.connected ? "setting-status active" : "setting-status"
                }
              >
                {state.connected ? "已接管" : "待命"}
              </span>
            </section>
            <section className="settings-card">
              <div>
                <b>连接健康检查</b>
                <p className="muted">
                  每 10 秒验证一次真实代理请求，连续失败三次判定线路异常。
                </p>
              </div>
              <span className="setting-status active">已启用</span>
            </section>
          </div>
        </div>
        <div className="settings-section core-manager">
          <div className="settings-section-heading">
            <div>
              <b>代理核心</b>
            </div>
            <button
              className="settings-action"
              disabled={
                checkingCores || updatingCore != null || state.connected
              }
              onClick={() => void checkCoreUpdates()}
            >
              {checkingCores ? (
                <>
                  <LoadingOutlined spin /> 检查中
                </>
              ) : (
                <>
                  <ReloadOutlined /> 检查更新
                </>
              )}
            </button>
          </div>
          {state.connected && (
            <div className="settings-notice">
              <ExclamationCircleOutlined /> 请先断开连接，再检查或更新核心。
            </div>
          )}
          {coreMessage && (
            <div className="settings-notice info">{coreMessage}</div>
          )}
          {coreVersions.length === 0 ? (
            <div className="core-empty">
              <CloudDownloadOutlined />
              <span>点击“检查更新”获取当前版本和最新版本。</span>
            </div>
          ) : (
            <div className="core-list">
              {coreVersions.map((core) => (
                <div className="core-row" key={core.coreId}>
                  <div className="core-name">
                    <b>{core.name}</b>
                    <span className={`core-source ${core.source}`}>
                      {core.source === "user"
                        ? "用户更新版"
                        : core.source === "bundled"
                          ? "内置版"
                          : "缺失"}
                    </span>
                  </div>
                  <div className="core-version">
                    <small>当前</small>
                    <span>
                      {core.currentVersion
                        ? `v${core.currentVersion}`
                        : "无法检测"}
                    </span>
                  </div>
                  <div className="core-version">
                    <small>最新</small>
                    <span>
                      {core.latestVersion
                        ? `v${core.latestVersion}`
                        : core.error
                          ? "检查失败"
                          : "-"}
                    </span>
                  </div>
                  <div
                    className={
                      core.outdated || !core.available
                        ? "core-status update"
                        : "core-status ok"
                    }
                  >
                    {core.outdated || !core.available ? (
                      <>
                        <ExclamationCircleOutlined /> 可更新
                      </>
                    ) : (
                      <>
                        <CheckCircleOutlined /> 已是最新
                      </>
                    )}
                  </div>
                  <div className="core-actions">
                    <button
                      className={
                        core.outdated || !core.available ? "primary-button" : ""
                      }
                      disabled={
                        !core.updateSupported ||
                        (!core.outdated && core.available) ||
                        updatingCore != null ||
                        state.connected
                      }
                      onClick={() => void installCoreUpdate(core)}
                    >
                      {updatingCore === core.coreId ? (
                        <LoadingOutlined spin />
                      ) : (
                        "更新"
                      )}
                    </button>
                    <button
                      disabled={
                        core.source !== "user" ||
                        updatingCore != null ||
                        state.connected
                      }
                      onClick={() => void restoreCore(core)}
                      title="恢复内置版本"
                    >
                      <RollbackOutlined />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="settings-section app-maintenance">
          <div className="settings-section-heading">
            <div>
              <b>软件更新</b>
            </div>
            <button className="settings-action" disabled={checkingAppUpdate} onClick={() => void checkAppUpdate()}>
              {checkingAppUpdate ? <><LoadingOutlined spin /> 检查中</> : <><CloudDownloadOutlined /> 检查更新</>}
            </button>
          </div>
          <div className="app-version-row">
            <div><small>当前版本</small><b>v{appUpdate?.currentVersion ?? "2.0.0"}</b></div>
            <div><small>最新版本</small><b>{appUpdate?.latestVersion ? `v${appUpdate.latestVersion}` : "尚未检查"}</b></div>
            <span className={appUpdate?.outdated ? "core-status update" : "core-status ok"}>{appUpdate ? appUpdate.outdated ? "发现新版本" : "已是最新版本" : "等待检查"}</span>
            {appUpdate?.outdated && <button className="primary-button release-button" onClick={() => void openUrl(appUpdate.releaseUrl)}>前往下载</button>}
          </div>
          {appUpdateError && <div className="settings-notice">{appUpdateError}</div>}
        </div>
        <div className="settings-section about-card">
          <div className="about-heading"><img src={kingoLogo} alt="KiNGO"/><div><b>KiNGO</b><p>轻量、多核心的网络代理管理桌面客户端</p></div></div>
          <div className="about-links">
            <button onClick={() => void openUrl("https://github.com/KINGHY02/KiNGO")}><GithubOutlined/><span>GitHub 项目主页</span></button>
            <button onClick={() => void openUrl("https://github.com/KINGHY02/KiNGO/releases")}><CloudDownloadOutlined/><span>版本发布与更新日志</span></button>
            <button onClick={() => void openUrl("https://t.me/kingovpn")}><TeamOutlined/><span>Telegram 用户群</span></button>
          </div>
          <div className="legal-block"><b><InfoCircleOutlined/> 版权与免责声明</b><p>Copyright © {new Date().getFullYear()} KINGHY02. All rights reserved.</p><p>本软件仅供学习、研究及个人合法使用，不提供任何代理服务。使用者应遵守所在国家或地区的法律法规，并自行承担因不当使用产生的责任。</p><small>作者：KINGHY02　·　项目：KiNGO　·　开源协议：MIT License</small></div>
        </div>
      </div>
    );
  if (page === "logs")
    return (
      <div className="page workspace">
        <div className="workspace-toolbar">
          <div>
            <p className="muted">连接、故障检测与自动切换记录</p>
          </div>
        </div>
        <section className="log-card">
          {logs.length ? (
            logs.map((entry, index) => (
              <div
                className={`log-row ${entry.level}`}
                key={`${entry.at}-${index}`}
              >
                <time>{entry.at}</time>
                <span>{entry.level}</span>
                <p>{entry.message}</p>
              </div>
            ))
          ) : (
            <div className="empty-log">暂无运行日志</div>
          )}
        </section>
      </div>
    );
  if (mode === "auto" && page === "connections")
    return (
      <div className="page workspace">
        <div className="workspace-toolbar">
          <div>
            <button className="back-button" onClick={() => onPage("home")}>
              ← 返回首页
            </button>
            <h2>连接详情</h2>
            <p className="muted">当前全自动连接的实时状态</p>
          </div>
        </div>
        <section className="detail-grid">
          <article>
            <small>连接状态</small>
            <b>
              {ownsConnection && state.connected
                ? "已连接"
                : ownsConnection && state.connecting
                  ? state.stage === "switching" ? "正在切换" : "正在连接"
                  : "未连接"}
            </b>
          </article>
          <article>
            <small>当前阶段</small>
            <b>{ownsConnection ? state.stage : "idle"}</b>
          </article>
          <article>
            <small>线路策略</small>
            <b>{routeId ?? "自动选择"}</b>
          </article>
          <article>
            <small>公共线路</small>
            <b>{ownsConnection ? state.displayName ?? "-" : "-"}</b>
          </article>
          <article>
            <small>出口 IP</small>
            <b>{ownsConnection ? state.exitIp ?? "-" : "-"}</b>
          </article>
          <article>
            <small>地区</small>
            <b>{ownsConnection ? state.country ?? "-" : "-"}</b>
          </article>
          <article>
            <small>延迟</small>
            <b>{!ownsConnection || state.latency == null ? "-" : `${state.latency} ms`}</b>
          </article>
          <article>
            <small>实时下载</small>
            <b>{formatBytes(ownsConnection ? state.downloadBps : 0, true)}</b>
          </article>
          <article>
            <small>实时上传</small>
            <b>{formatBytes(ownsConnection ? state.uploadBps : 0, true)}</b>
          </article>
        </section>
        {ownsConnection && state.error && <div className="connection-alert">{state.error}</div>}
      </div>
    );
  return (
    <div className="page workspace">
      <div className="workspace-toolbar">
        <div>
          <p className="muted">
            {mode === "auto"
              ? updateProgress
                ? `正在更新 ${updateProgress.completed}/${updateProgress.total} · ${updateProgress.routeName}`
                : progress
                  ? `测速进度 ${progress.completed}/${progress.total} · ${progress.routeName}`
                  : updateSummary
                    ? updateSummary.cancelled
                      ? `线路更新已取消：已更新 ${updateSummary.updated}`
                      : `线路更新完成：成功 ${updateSummary.updated}，失败 ${updateSummary.failed}`
                    : testSummary
                      ? testSummary.cancelled
                        ? "最近一次测速已取消"
                        : `测速完成：${testSummary.succeeded}/${testSummary.total} 条可用`
                      : `当前策略：${selectedRouteName}`
              : "功能区正在接入统一服务层"}
          </p>
        </div>
        <div className="toolbar-actions">
          {mode === "auto" && (
            <>
              <button
                className="primary-button"
                disabled={state.connected || updateProgress != null}
                onClick={() => {
                  setTestSummary(null);
                  void invoke(
                    state.connecting
                      ? "cancel_connection"
                      : "test_public_routes",
                  );
                }}
              >
                {state.connecting ? "取消测速" : "测试全部线路"}
              </button>
              <button
                disabled={state.connected || state.connecting}
                onClick={() => {
                  if (updateProgress) {
                    void invoke("cancel_public_route_update");
                    return;
                  }
                  setUpdateSummary(null);
                  setUpdateProgress({
                    completed: 0,
                    total: routes.length,
                    routeId: "",
                    routeName: "准备中",
                    success: true,
                    error: null,
                  });
                  void invoke("update_public_routes").catch((error) => {
                    setUpdateProgress(null);
                    setUpdateSummary({
                      success: false,
                      cancelled: false,
                      updated: 0,
                      failed: 1,
                      errors: [{ routeId: "", message: String(error) }],
                    });
                  });
                }}
              >
                {updateProgress ? "取消更新" : "更新线路"}
              </button>
              <button
                onClick={() =>
                  void invoke<Route[]>("list_public_routes").then(setRoutes)
                }
              >
                刷新
              </button>
            </>
          )}
        </div>
      </div>
      {mode === "auto" ? (
        <div className="route-list">
          <div
            className={
              routeId == null ? "route-row route-selected" : "route-row"
            }
          >
            <span className="route-index">自动</span>
            <b>自动选择</b>
            <span className="muted">
              优先最近成功且延迟较低的线路，失败后继续尝试
            </span>
            <span className="delay">{routeId == null ? "当前" : "推荐"}</span>
            <div className="route-actions auto-route-actions">
              <button disabled={state.connecting || routeId == null} onClick={() => onRoute("")}>
                {routeId == null ? (state.connected && state.mode === "auto" ? "自动模式" : "已选择") : state.connected && state.mode === "auto" ? "切换" : "选择"}
              </button>
            </div>
          </div>
          {routes.map((route, index) => {
            const testing = progress?.routeId === route.id && state.connecting;
            const selected = routeId === route.id;
            return (
              <div
                className={route.active ? "route-row route-selected route-active" : selected ? "route-row route-selected" : "route-row"}
                key={route.id}
                title={route.lastError ?? undefined}
              >
                <span className="route-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <b>{routeDisplayName(route)}</b>
                <span
                  className={route.lastError ? "route-message error" : "muted"}
                >
                  {testing
                    ? `正在启动 ${route.protocolLabel} 核心并验证线路`
                    : routeDescription(route, selected)}
                </span>
                <span
                  className="delay"
                  style={{
                    color: testing
                      ? "#4b6ff0"
                      : latencyColor(route.latency, route.lastError != null),
                  }}
                >
                  {testing
                    ? "测速中"
                    : route.lastError
                      ? "失败"
                      : route.latency != null
                        ? `${route.latency} ms`
                        : "未测"}
                </span>
                <div className="route-actions">
                  <button
                    disabled={
                      state.connected ||
                      updateProgress != null ||
                      (state.connecting && !testing)
                    }
                    onClick={() => {
                      setTestSummary(null);
                      void invoke(
                        testing ? "cancel_connection" : "test_public_route",
                        testing ? undefined : { routeId: route.id },
                      );
                    }}
                  >
                    {testing ? "取消" : "测速"}
                  </button>
                  <button disabled={state.connecting || route.active} onClick={() => onRoute(route.id)}>
                    {route.active ? "正在使用" : selected ? "已选择" : state.connected && state.mode === "auto" ? "切换" : "选择"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <span>◌</span>
          <b>功能模块</b>
          <small>该工作区将在下一阶段接入。</small>
        </div>
      )}
    </div>
  );
}

export default App;
