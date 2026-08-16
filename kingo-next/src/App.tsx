import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  CheckCircleOutlined,
  CloudDownloadOutlined,
  CloudOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  DisconnectOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  GithubOutlined,
  HeartOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  LeftOutlined,
  MoonOutlined,
  PoweroffOutlined,
  ReloadOutlined,
  RightOutlined,
  RollbackOutlined,
  SettingOutlined,
  SunOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import "./App.css";
import "./Home.css";
import kingoLogo from "./assets/kingo-logo.png";

type Mode = "auto";
type Theme = "light" | "dark" | "pink" | "blue";
type Page =
  | "home"
  | "routes"
  | "community"
  | "connections"
  | "logs"
  | "settings";
export type AppState = {
  mode: string;
  connected: boolean;
  connecting: boolean;
  stage: string;
  coreId: string | null;
  sourceType: string | null;
  nodeId: string | null;
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
  successRate: number | null;
  jitter: number | null;
  quality: string;
};
type LogEntry = { at: string; level: string; message: string };
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
type CommunityScanState = {
  jobId: string | null;
  state: string;
  stage: string;
  sourceTotal: number;
  sourceDone: number;
  sourceSucceeded: number;
  sourceFailed: number;
  rawTotal: number;
  deduplicatedTotal: number;
  aliveTotal: number;
  aliveDone: number;
  aliveSucceeded: number;
  speedTotal: number;
  speedDone: number;
  speedSucceeded: number;
  finalistTotal: number;
  finalistDone: number;
  retainedTotal: number;
  bytesDownloaded: number;
  startedAt: number | null;
  updatedAt: number | null;
  completedAt: number | null;
  usingRemoteManifest: boolean;
  message: string | null;
};
type CommunityNode = {
  id: string;
  displayName: string;
  originalName: string;
  protocol: string;
  server: string;
  port: number;
  latencyMedianMs: number | null;
  speedMedianKbps: number | null;
  countryName: string | null;
  exitIp: string | null;
  exitVerified: boolean;
  sourceIds: string[];
  lastTestedAt: number | null;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
};
type CommunitySettings = {
  retainCount: number;
  sortMode: "balanced" | "latency" | "speed";
  speedConcurrency: number;
  speedTimeoutSeconds: number;
};
type AutoRoutingMode = "rule" | "global" | "direct";
type AutoRoutingAction = "direct" | "proxy" | "block";
type AutoRoutingRule = {
  id: string;
  target: string;
  action: AutoRoutingAction;
  enabled: boolean;
};
type AutoRoutingSettings = {
  mode: AutoRoutingMode;
  rules: AutoRoutingRule[];
};
type AutoRoutingApplyResult = {
  settings: AutoRoutingSettings;
  applied: boolean;
  restarted: boolean;
  message: string;
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
type AppUpdateInfo = {
  currentVersion: string;
  latestVersion: string | null;
  outdated: boolean;
  releaseUrl: string;
  notes?: string | null;
  installable?: boolean;
};
type AppUpdateProgress = {
  stage: "downloading" | "preparing" | "installing";
  downloaded: number;
  total: number | null;
  percent: number | null;
};
type SpeedTestSettings = {
  url: string;
  fallbackUrls: string[];
  downloadUrl: string;
  timeoutSeconds: number;
  concurrency: number;
};
type SpeedTestUrlResult = { url: string; status: number; latencyMs: number };

const LATENCY_URL_PRESETS = [
  { label: "Gstatic 204", url: "https://www.gstatic.com/generate_204" },
  { label: "Cloudflare 204", url: "http://cp.cloudflare.com/generate_204" },
  { label: "Microsoft 连通性", url: "http://www.msftconnecttest.com/connecttest.txt" },
  { label: "Apple 连通性", url: "https://www.apple.com/library/test/success.html" },
] as const;
const DOWNLOAD_URL_PRESETS = [
  { label: "Cloudflare 10 MB", url: "https://speed.cloudflare.com/__down?bytes=10000000" },
  { label: "Cloudflare 50 MB", url: "https://speed.cloudflare.com/__down?bytes=50000000" },
  { label: "CacheFly 10 MB", url: "https://cachefly.cachefly.net/10mb.test" },
] as const;
const DEFAULT_SPEED_TEST_SETTINGS: SpeedTestSettings = {
  url: LATENCY_URL_PRESETS[0].url,
  fallbackUrls: [LATENCY_URL_PRESETS[1].url, LATENCY_URL_PRESETS[2].url],
  downloadUrl: DOWNLOAD_URL_PRESETS[0].url,
  timeoutSeconds: 4,
  concurrency: 6,
};

const emptyState: AppState = {
  mode: "auto",
  connected: false,
  connecting: false,
  stage: "idle",
  coreId: null,
  sourceType: null,
  nodeId: null,
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

function routeDisplayName(route: Route, index?: number) {
  const country = route.country?.split(" · ")[0] ?? "公共";
  const number = index == null ? route.slot || null : index + 1;
  return number ? `${country} ${String(number).padStart(2, "0")}` : country;
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
  const mode: Mode = "auto";
  const [page, setPage] = useState<Page>("home");
  const [state, setState] = useState<AppState>(emptyState);
  const [routeId, setRouteId] = useState<string | null>(
    () => localStorage.getItem("kingo-auto-route") || null,
  );
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [appVersion, setAppVersion] = useState("2.0.4");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(() => localStorage.getItem("kingo-motion") !== "off");
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("kingo-theme") as Theme) || "light");
  const themeLabels: Record<Theme, string> = { light: "亮色", dark: "暗色", pink: "樱花粉", blue: "冰川蓝" };
  const switchTheme = () => { const themes: Theme[] = ["light", "dark", "pink", "blue"]; const next = themes[(themes.indexOf(theme) + 1) % themes.length]; setTheme(next); localStorage.setItem("kingo-theme", next); };

  useEffect(() => {
    void getVersion().then(setAppVersion).catch(() => undefined);
  }, []);

  useEffect(() => {
    void invoke<AppState>("get_app_state")
      .then(setState)
      .catch(() => undefined);
    void invoke("select_public_route", { routeId }).catch(() => undefined);
    let cleanup: (() => void) | undefined;
    let disposed = false;
    void listen<AppState>("connection-state", (event) =>
      setState(event.payload),
    ).then((value) => {
      if (disposed) value(); else cleanup = value;
    });
    return () => { disposed = true; cleanup?.(); };
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let disposed = false;
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
      if (disposed) value(); else cleanup = value;
    });
    return () => { disposed = true; cleanup?.(); };
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let disposed = false;
    void listen<string | null>("public-route-selection", (event) => {
      const value = event.payload;
      setRouteId(value);
      if (value) localStorage.setItem("kingo-auto-route", value);
      else localStorage.removeItem("kingo-auto-route");
    }).then((value) => {
      if (disposed) value(); else cleanup = value;
    });
    return () => { disposed = true; cleanup?.(); };
  }, []);

  useEffect(() => {
    if (!state.connected) return;
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

  const nav = useMemo(
    () =>
      [
        ["home", "首页", <DashboardOutlined />],
        ["routes", "线路", <CloudServerOutlined />],
        ["community", "获取节点", <CloudDownloadOutlined />],
        ["logs", "日志", <FileTextOutlined />],
        ["settings", "设置", <SettingOutlined />],
      ] as const,
    [],
  );

  async function handleNav(id: string) {
    setPage(id as Page);
  }

  async function connectToggle() {
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

  const autoViewState: AppState = state;

  async function refreshExit() {
    try {
      const refreshed = await invoke<AppState>("refresh_exit_info");
      setState(refreshed);
      return refreshed;
    } catch (error) {
      setState((value) => ({ ...value, error: String(error) }));
      throw error;
    }
  }

  return (
    <div className={`app-shell theme-${theme}${motionEnabled ? "" : " motion-off"}`}>
      <aside className={sidebarCollapsed ? "sidebar collapsed" : "sidebar"}>
        <div className="brand">
          <img className="brand-logo" src={kingoLogo} alt="KiNGO" />
          <span>KiNGO</span>
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
      <main className="content">
        <header className="topbar">
          <div>
            <h1>
              {page === "home"
                ? "首页"
                : (nav.find((item) => item[0] === page)?.[1] ?? "KiNGO")}
            </h1>
          </div>
          <span className={`proxy-badge ${state.connected ? "active" : state.connecting ? "working" : ""}`}>
            <i aria-hidden="true" />
            {state.connecting
              ? "正在连接"
              : state.connected && state.tunEnabled
                ? "TUN 已开启"
                : state.connected
                  ? "系统代理已开启"
                  : state.tunEnabled
                    ? "TUN 待连接"
                    : "系统代理未开启"}
          </span>
        </header>
        {page === "home" ? (
          <Home
            state={autoViewState}
            onToggle={connectToggle}
            onRefresh={refreshExit}
            onNavigate={setPage}
          />
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
  onRefresh: () => Promise<AppState>;
  onNavigate: (page: Page) => void;
}) {
  const [refreshingExit, setRefreshingExit] = useState(false);
  const [exitRefreshMessage, setExitRefreshMessage] = useState<string | null>(null);
  const [routing, setRouting] = useState<AutoRoutingSettings>({ mode: "rule", rules: [] });
  const [routingSaving, setRoutingSaving] = useState(false);
  useEffect(() => {
    let active = true;
    void invoke<AutoRoutingSettings>("get_auto_routing_settings")
      .then(async (settings) => {
        if (!active) return;
        if (settings.mode !== "direct") {
          setRouting(settings);
          return;
        }
        const result = await invoke<AutoRoutingApplyResult>(
          "set_auto_routing_settings",
          { settings: { ...settings, mode: "rule" } },
        );
        if (active) setRouting(result.settings);
      })
      .catch((error) => console.error("读取代理模式失败", error));
    return () => {
      active = false;
    };
  }, []);
  const changeRoutingMode = async (mode: "rule" | "global") => {
    if (routingSaving || routing.mode === mode) return;
    setRoutingSaving(true);
    try {
      const result = await invoke<AutoRoutingApplyResult>(
        "set_auto_routing_settings",
        { settings: { ...routing, mode } },
      );
      setRouting(result.settings);
    } catch (error) {
      console.error("切换代理模式失败", error);
    } finally {
      setRoutingSaving(false);
    }
  };
  const button = state.connecting
    ? state.stage === "switching" ? "切换中" : "连接中"
    : state.connected
      ? "断开"
      : "连接";
  const title = state.connecting
    ? (state.stage === "switching" ? "正在切换线路" : "正在建立连接")
    : state.connected
      ? state.displayName
      : state.error
        ? "连接失败"
        : "选择线路并连接";
  const phaseText = state.stage === "preparing"
    ? "正在准备线路与核心"
    : state.stage === "probing"
      ? "正在并行快速筛选可用线路"
    : state.stage === "switching"
      ? "正在验证并切换新线路"
      : state.stage === "applying-routing"
        ? "正在应用代理模式"
        : state.stage === "failover"
          ? "当前线路异常，正在自动重选"
          : state.displayName ?? "正在启动核心并验证代理";
  return (
    <div className="page home-page">
      <section className="hero-card auto-hero-card">
        <div className="hero-info">
          <div className="home-heading-row">
            <div>
              <h2>{title}</h2>
              {(state.error || state.connected || state.connecting) && (
                <p className="muted">
                  {state.error ?? (state.connected ? "当前线路运行正常，KiNGO 会持续监测并在异常时自动保护连接。" : phaseText)}
                </p>
              )}
            </div>
            <div className="home-routing-mode" aria-label="代理模式">
              <div className="home-routing-switch">
                <button
                  className={routing.mode === "rule" ? "active" : ""}
                  disabled={routingSaving}
                  onClick={() => void changeRoutingMode("rule")}
                >
                  规则
                </button>
                <button
                  className={routing.mode === "global" ? "active" : ""}
                  disabled={routingSaving}
                  onClick={() => void changeRoutingMode("global")}
                >
                  全局
                </button>
              </div>
            </div>
          </div>
          <div className={`home-route-summary ${state.connected ? "connected" : ""}`}>
            <span className="home-route-icon"><CloudServerOutlined /></span>
            <div className="home-route-main">
              <small>{state.connected ? "当前线路" : state.connecting ? "连接进度" : "连接线路"}</small>
              <b>{state.connecting ? phaseText : state.displayName ?? "自动选择最佳线路"}</b>
            </div>
            {state.connected ? (
              <div className="home-live-metrics">
                <span><small>延迟</small><b>{state.latency ? `${state.latency} ms` : "检测中"}</b></span>
                <span><small>地区</small><b>{state.country ?? "未知"}</b></span>
                <span><small>出口 IP</small><b>{state.exitIp ?? "获取中"}</b></span>
              </div>
            ) : null}
            <button className="home-route-action" onClick={() => onNavigate("routes")}>{state.connected ? "更换" : "选择"}</button>
          </div>
          {state.connected && <div className="small-actions">
            {state.connected && <button onClick={() => {
              setRefreshingExit(true);
              setExitRefreshMessage(null);
              void onRefresh()
                .then(refreshed => setExitRefreshMessage(`已重新查询：${refreshed.exitIp ?? "未知 IP"}`))
                .catch(error => setExitRefreshMessage(`刷新失败：${String(error)}`))
                .finally(() => setRefreshingExit(false));
            }} disabled={state.connecting || refreshingExit}>{refreshingExit ? "查询中…" : "刷新出口 IP"}</button>}
            {state.connected && <button onClick={() => onNavigate("connections")}>连接详情</button>}
          </div>}
          {state.connected && exitRefreshMessage && <small className="home-refresh-feedback">{exitRefreshMessage}</small>}
        </div>
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
                  ? "点击断开"
                  : "自动选择最佳线路"}
            </small>
          </button>
        </div>
      </section>
      <section className={`traffic-card ${state.connected ? "" : "traffic-card-empty"}`}>
        {state.connected ? (<>
          <div className="section-title"><b>实时流量</b><span>当前连接</span></div>
          <div className="traffic-values">
            <div>
              <small>下载</small>
              <strong className="download">{formatBytes(state.downloadBps, true)}</strong>
              <small>累计 {formatBytes(state.downloadTotal)}</small>
            </div>
            <div>
              <small>上传</small>
              <strong className="upload">{formatBytes(state.uploadBps, true)}</strong>
              <small>累计 {formatBytes(state.uploadTotal)}</small>
            </div>
            <TrafficChart up={state.uploadBps} down={state.downloadBps} connected />
          </div>
        </>) : (
          <div className="traffic-empty-state">
            <DashboardOutlined />
            <div>
              <b>{state.connecting ? "正在建立连接" : "连接后显示实时流量"}</b>
              <small>下载、上传与累计用量将在这里实时更新</small>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

const EMPTY_COMMUNITY_SCAN: CommunityScanState = {
  jobId: null, state: "idle", stage: "idle", sourceTotal: 0, sourceDone: 0,
  sourceSucceeded: 0, sourceFailed: 0, rawTotal: 0, deduplicatedTotal: 0,
  aliveTotal: 0, aliveDone: 0, aliveSucceeded: 0, speedTotal: 0, speedDone: 0,
  speedSucceeded: 0, finalistTotal: 0, finalistDone: 0, retainedTotal: 0,
  bytesDownloaded: 0, startedAt: null, updatedAt: null, completedAt: null,
  usingRemoteManifest: false, message: null,
};

function shouldAcceptCommunityScan(current: CommunityScanState, incoming: CommunityScanState) {
  if (current.jobId !== incoming.jobId) {
    return (incoming.startedAt ?? incoming.updatedAt ?? 0) >= (current.startedAt ?? current.updatedAt ?? 0);
  }
  if ((incoming.updatedAt ?? 0) !== (current.updatedAt ?? 0)) {
    return (incoming.updatedAt ?? 0) > (current.updatedAt ?? 0);
  }
  const terminalRank = (value: CommunityScanState) => ["completed", "failed", "stopped"].includes(value.state) ? 1_000_000 : value.state === "stopping" ? 500_000 : 0;
  const progressRank = (value: CommunityScanState) => terminalRank(value) + value.sourceDone + value.aliveDone + value.speedDone + value.retainedTotal;
  return progressRank(incoming) >= progressRank(current);
}

function CommunityNodesPage({ state }: { state: AppState }) {
  const [scan, setScan] = useState<CommunityScanState>(EMPTY_COMMUNITY_SCAN);
  const [nodes, setNodes] = useState<CommunityNode[]>([]);
  const [settings, setSettings] = useState<CommunitySettings>({
    retainCount: 50, sortMode: "speed", speedConcurrency: 4, speedTimeoutSeconds: 10,
  });
  const [error, setError] = useState<string | null>(null);
  const [retesting, setRetesting] = useState<Set<string>>(new Set());
  const [batchRetest, setBatchRetest] = useState<{ done: number; total: number } | null>(null);
  const [connectingNode, setConnectingNode] = useState<string | null>(null);
  const [lastRequestedNode, setLastRequestedNode] = useState<string | null>(null);
  const [nodeSearch, setNodeSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState("all");
  const [protocolFilter, setProtocolFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [progressClock, setProgressClock] = useState(() => Math.floor(Date.now() / 1000));
  const running = ["running", "stopping"].includes(scan.state);
  const refreshNodes = () => invoke<CommunityNode[]>("list_community_nodes").then(setNodes).catch(() => undefined);
  const acceptScan = (incoming: CommunityScanState) => {
    setScan(current => shouldAcceptCommunityScan(current, incoming) ? incoming : current);
  };

  useEffect(() => {
    if (!state.connecting) setConnectingNode(null);
  }, [state.connecting, state.connected, state.error]);

  useEffect(() => {
    if (state.sourceType === "community" && state.error) setError(state.error);
    else if (state.sourceType === "community" && state.connected) setError(null);
  }, [state.sourceType, state.connected, state.error]);

  useEffect(() => {
    if (!running || scan.state === "paused") return;
    const timer = window.setInterval(() => setProgressClock(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [running, scan.state]);

  useEffect(() => {
    void invoke<CommunityScanState>("get_community_scan_state").then(acceptScan).catch(() => undefined);
    void refreshNodes();
    void invoke<CommunitySettings>("get_community_settings").then(setSettings).catch(() => undefined);
    let cleanup: (() => void) | undefined;
    let disposed = false;
    let cleanupRetest: (() => void) | undefined;
    let cleanupBatchRetest: (() => void) | undefined;
    void listen<CommunityScanState>("community-scan-progress", event => {
      acceptScan(event.payload);
      if (["completed", "stopped", "failed"].includes(event.payload.state)) void refreshNodes();
    }).then(value => { if (disposed) value(); else cleanup = value; });
    void listen<{ nodeId: string; state: string; error?: string; batch?: boolean }>("community-node-retest", event => {
      setRetesting(current => {
        const next = new Set(current);
        if (event.payload.state === "running") next.add(event.payload.nodeId);
        else next.delete(event.payload.nodeId);
        return next;
      });
      if (event.payload.state === "completed") {
        if (!event.payload.batch) {
          void refreshNodes();
          if (event.payload.error) setError(event.payload.error);
        }
      }
    }).then(value => { if (disposed) value(); else cleanupRetest = value; });
    void listen<{ state: string; done: number; total: number }>("community-retest-batch", event => {
      setBatchRetest(event.payload.state === "completed" ? null : { done: event.payload.done, total: event.payload.total });
      if (event.payload.state === "completed") void refreshNodes();
    }).then(value => { if (disposed) value(); else cleanupBatchRetest = value; });
    return () => { disposed = true; cleanup?.(); cleanupRetest?.(); cleanupBatchRetest?.(); };
  }, []);

  const runCommand = async (command: string) => {
    setError(null);
    try { acceptScan(await invoke<CommunityScanState>(command)); }
    catch (value) { setError(String(value)); }
  };
  const saveSettings = async (next: CommunitySettings) => {
    const previous = settings;
    setSettings(next);
    try { setSettings(await invoke<CommunitySettings>("save_community_settings", { settings: next })); }
    catch (value) { setSettings(previous); setError(String(value)); }
  };
  const retestNode = async (nodeId: string) => {
    setError(null);
    setRetesting(current => new Set(current).add(nodeId));
    try { await invoke("retest_community_node", { nodeId }); }
    catch (value) {
      setRetesting(current => { const next = new Set(current); next.delete(nodeId); return next; });
      setError(String(value));
    }
  };
  const connectNode = async (nodeId: string) => {
    setError(null);
    setLastRequestedNode(nodeId);
    setConnectingNode(nodeId);
    try { await invoke("connect_community_node", { nodeId }); }
    catch (value) { setConnectingNode(null); setError(String(value)); }
  };
  const retestAllNodes = async () => {
    setError(null);
    setBatchRetest({ done: 0, total: 0 });
    try {
      const total = await invoke<number>("retest_all_community_nodes");
      setBatchRetest(current => current ? { done: current.done, total } : null);
    } catch (value) {
      setBatchRetest(null);
      setError(String(value));
    }
  };
  const connectWithoutTun = async () => {
    const nodeId = lastRequestedNode ?? state.nodeId;
    if (!nodeId) return;
    setError(null);
    try {
      await invoke<AppState>("set_auto_tun", { enabled: false });
      await connectNode(nodeId);
    } catch (value) {
      setError(String(value));
    }
  };
  const stageProgress = scan.stage === "subs_check_alive"
    ? [scan.aliveDone, scan.aliveTotal]
    : scan.stage === "subs_check_speed"
      ? [scan.speedDone, scan.speedTotal]
      : [0, 0];
  const progressKnown = scan.state === "completed" || stageProgress[1] > 0;
  const percent = scan.state === "completed"
    ? 100
    : stageProgress[1] > 0 ? Math.min(100, Math.round(stageProgress[0] / stageProgress[1] * 100)) : 0;
  const stageIndex = scan.state === "completed" ? 3
    : scan.stage === "subs_check_speed" ? 2
      : scan.stage === "subs_check_alive" ? 1 : 0;
  const taskTitle = scan.state === "completed"
    ? `检测完成，保留 ${scan.retainedTotal} 个节点`
    : scan.state === "failed"
      ? "节点检测失败"
      : scan.state === "stopped"
        ? "节点检测已停止"
        : scan.state === "stopping"
          ? "正在停止节点检测"
          : scan.stage === "subs_check_speed"
            ? `下载测速 ${scan.speedDone} / ${scan.speedTotal || "待确定"}`
            : scan.stage === "subs_check_alive"
              ? `节点测活 ${scan.aliveDone} / ${scan.aliveTotal || "待确定"}`
              : scan.state === "running"
                ? "正在获取、解析并去重订阅"
                : "尚未开始获取节点";
  const progressIdleSeconds = scan.updatedAt ? Math.max(0, progressClock - scan.updatedAt) : 0;
  const progressHealth = scan.state === "running" && progressIdleSeconds >= 20
      ? `已有 ${progressIdleSeconds} 秒没有完成新节点，正在等待检测服务或复杂配置`
      : null;
  const taskDetail = scan.state === "idle"
    ? "点击开始获取后，将依次处理订阅、测活并进行下载测速。"
    : scan.state === "failed"
      ? scan.message ?? "检测未完成，请查看错误后重试。"
      : progressHealth ?? (scan.stage === "subs_check_fetch" || scan.stage === "subs_check_starting"
        ? "订阅获取阶段无法取得逐条进度，完成解析后将显示准确的节点测活数量。"
        : "进度条表示当前阶段，不是对整轮任务的估算。进入下一阶段后会按新阶段重新计算。");
  const countries = useMemo(() => [...new Set(nodes.map(node => node.countryName).filter((value): value is string => Boolean(value)))].sort(), [nodes]);
  const protocols = useMemo(() => [...new Set(nodes.map(node => node.protocol))].sort(), [nodes]);
  const filteredNodes = useMemo(() => {
    const keyword = nodeSearch.trim().toLowerCase();
    return nodes.filter(node => {
      const available = node.exitVerified && (node.latencyMedianMs != null || node.speedMedianKbps != null);
      if (countryFilter !== "all" && node.countryName !== countryFilter) return false;
      if (protocolFilter !== "all" && node.protocol !== protocolFilter) return false;
      if (statusFilter === "available" && !available) return false;
      if (statusFilter === "failed" && available) return false;
      return !keyword || [node.displayName, node.originalName, node.server, node.exitIp ?? ""].some(value => value.toLowerCase().includes(keyword));
    });
  }, [nodes, nodeSearch, countryFilter, protocolFilter, statusFilter]);

  return (
    <div className="page workspace community-page">
      <div className="workspace-toolbar community-toolbar">
        <div><p className="muted">聚合公开订阅并在后台检测，只保留测速排名靠前的节点。</p></div>
        <div className="toolbar-actions">
          {!running && <button className="primary-button" disabled={state.connecting || (state.connected && state.sourceType === "community")} onClick={() => void runCommand("start_community_scan")}>开始获取</button>}
          {running && <button className="danger" disabled={scan.state === "stopping"} onClick={() => void runCommand("stop_community_scan")}>{scan.state === "stopping" ? "停止中…" : "停止"}</button>}
          <button disabled={running || nodes.length === 0 || retesting.size > 0 || batchRetest != null} onClick={() => void retestAllNodes()}>{batchRetest ? `批量复测 ${batchRetest.done}/${batchRetest.total || "…"}` : "复测全部"}</button>
          <button disabled={running || nodes.length === 0 || retesting.size > 0 || batchRetest != null || state.connecting || (state.connected && state.sourceType === "community")} onClick={async () => { setError(null); try { await invoke("clear_community_nodes"); setNodes([]); } catch (value) { setError(String(value)); } }}>清空结果</button>
        </div>
      </div>
      <section className="community-summary">
        <div><span>订阅清单</span><b>{scan.sourceTotal || 65} 条</b><small>{scan.state === "running" && stageIndex === 0 ? "正在获取与解析" : stageIndex > 0 || scan.state === "completed" ? "订阅处理已完成" : "固定内置清单"}</small></div>
        <div><span>去重后候选</span><b>{scan.deduplicatedTotal || "-"}</b><small>{scan.deduplicatedTotal ? "重复配置已合并" : "解析完成后显示"}</small></div>
        <div><span>测活通过</span><b>{scan.aliveSucceeded}</b><small>{scan.aliveDone} / {scan.aliveTotal || "待开始"} 已检测</small></div>
        <div><span>测速通过</span><b>{scan.speedSucceeded}</b><small>{scan.speedDone} / {scan.speedTotal || "待开始"} 已检测</small></div>
        <div><span>最终保留</span><b>{running ? "待定" : nodes.length}</b><small>{running ? `当前列表为上轮 ${nodes.length} 个` : `目标 ${settings.retainCount} 个`}</small></div>
      </section>
      <section className="community-task-card">
        <div className="community-task-heading"><div><b>{taskTitle}</b><small>{taskDetail}</small></div><strong>{progressKnown ? `${percent}%` : scan.state === "running" ? "处理中" : "0%"}</strong></div>
        <div className="community-stage-track" aria-label="节点检测阶段">
          {["订阅处理", "节点测活", "下载测速"].map((label, index) => <span key={label} className={stageIndex > index ? "done" : stageIndex === index && running ? "current" : ""}>{label}</span>)}
        </div>
        {progressKnown ? <progress aria-label="当前阶段进度" max={100} value={percent} /> : <progress aria-label="当前阶段正在处理" max={100} />}
        <div className="community-options">
          <label><span>保留数量</span><select disabled={running || retesting.size > 0 || batchRetest != null} value={settings.retainCount} onChange={event => void saveSettings({ ...settings, retainCount: Number(event.target.value) })}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option><option value={200}>200</option></select></label>
          <label><span>测速并发</span><select disabled={running || retesting.size > 0 || batchRetest != null} value={settings.speedConcurrency} onChange={event => void saveSettings({ ...settings, speedConcurrency: Number(event.target.value) })}>{[1,2,3,4,5,6,7,8].map(value => <option value={value} key={value}>{value}</option>)}</select></label>
        </div>
        {error && (
          <div className="connection-alert community-connection-alert">
            <span>{error}</span>
            {error.includes("管理员权限") && (
              <div className="connection-alert-actions">
                <button onClick={() => void connectWithoutTun()}>关闭 TUN 后连接</button>
                <button className="primary-button" onClick={() => void invoke("restart_as_admin")}>管理员重启</button>
              </div>
            )}
          </div>
        )}
      </section>
      <section className="community-filters">
        <input value={nodeSearch} onChange={event => setNodeSearch(event.target.value)} placeholder="搜索节点、地址或出口 IP" />
        <select value={countryFilter} onChange={event => setCountryFilter(event.target.value)}><option value="all">全部国家</option>{countries.map(country => <option value={country} key={country}>{country}</option>)}</select>
        <select value={protocolFilter} onChange={event => setProtocolFilter(event.target.value)}><option value="all">全部协议</option>{protocols.map(protocol => <option value={protocol} key={protocol}>{protocol.toUpperCase()}</option>)}</select>
        <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">全部状态</option><option value="available">可用</option><option value="failed">复测失败</option></select>
        <span>{filteredNodes.length} / {nodes.length}</span>
      </section>
      <section className="community-node-list">
        <div className="community-node-head"><span>#</span><span>节点</span><span>协议</span><span>延迟</span><span>下载速度</span><span>出口 IP</span><span>操作</span></div>
        {filteredNodes.length ? filteredNodes.map((node, index) => (
          <div className={`community-node-row ${node.lastErrorDetail ? "has-error" : ""}`} key={node.id} title={`${node.originalName}\n来源 ${node.sourceIds.length} 个${node.lastErrorDetail ? `\n失败原因：${node.lastErrorDetail}` : ""}`}>
            <span>{String(index + 1).padStart(2, "0")}</span><b>{node.displayName || node.countryName || "未知地区"}</b><span>{node.protocol.toUpperCase()}</span><span className={node.latencyMedianMs == null && node.lastErrorDetail ? "community-failed-value" : ""}>{node.latencyMedianMs == null ? node.lastErrorDetail ? "失败" : node.speedMedianKbps != null ? "待复测" : "-" : `${node.latencyMedianMs} ms`}</span><span>{node.speedMedianKbps == null ? "-" : `${(node.speedMedianKbps / 1024).toFixed(1)} MB/s`}</span><span>{node.exitIp ?? "-"}</span><span className="community-node-actions"><button disabled={retesting.has(node.id) || running || batchRetest != null || state.connecting} onClick={() => void retestNode(node.id)}>{retesting.has(node.id) ? "复测中" : "复测"}</button><button className={state.connected && state.sourceType === "community" && state.nodeId === node.id ? "selected" : ""} disabled={running || retesting.has(node.id) || batchRetest != null || state.connecting || (state.connected && state.sourceType === "community" && state.nodeId === node.id)} onClick={() => void connectNode(node.id)}>{state.connected && state.sourceType === "community" && state.nodeId === node.id ? "已连接" : connectingNode === node.id && state.connecting ? "连接中" : "连接"}</button></span>
          </div>
        )) : <div className="community-empty">{nodes.length ? "没有符合当前筛选条件的节点。" : "完成检测后，可用节点会显示在这里。"}</div>}
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
  const [refreshingRoutes, setRefreshingRoutes] = useState(false);
  const [routeRefreshMessage, setRouteRefreshMessage] = useState<string | null>(null);
  const [coreVersions, setCoreVersions] = useState<CoreVersionInfo[]>([]);
  const [checkingCores, setCheckingCores] = useState(false);
  const [updatingCore, setUpdatingCore] = useState<string | null>(null);
  const [coreMessage, setCoreMessage] = useState<string | null>(null);
  const [appUpdate, setAppUpdate] = useState<AppUpdateInfo | null>(null);
  const [checkingAppUpdate, setCheckingAppUpdate] = useState(false);
  const [appUpdateError, setAppUpdateError] = useState<string | null>(null);
  const [installingAppUpdate, setInstallingAppUpdate] = useState(false);
  const [appUpdateProgress, setAppUpdateProgress] = useState<AppUpdateProgress | null>(null);
  const pendingAppUpdate = useRef<Update | null>(null);
  const [speedSettings, setSpeedSettings] = useState<SpeedTestSettings>(DEFAULT_SPEED_TEST_SETTINGS);
  const [speedSettingsMessage, setSpeedSettingsMessage] = useState<string | null>(null);
  const [testingSpeedUrl, setTestingSpeedUrl] = useState<"latency" | "download" | null>(null);
  const [loopbackMessage, setLoopbackMessage] = useState<string | null>(null);
  const [tunMessage, setTunMessage] = useState<string | null>(null);
  useEffect(() => {
    if (page !== "settings") return;
    void invoke<SpeedTestSettings>("get_speed_test_settings").then(setSpeedSettings).catch(() => undefined);
  }, [page]);
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
    let disposed = false;
    void listen<RouteProgress>("public-route-progress", (event) => {
      setProgress(event.payload);
      void invoke<Route[]>("list_public_routes")
        .then(setRoutes)
        .catch(() => undefined);
    }).then((value) => {
      if (disposed) value(); else cleanup = value;
    });
    return () => { disposed = true; cleanup?.(); };
  }, [mode]);
  useEffect(() => {
    if (mode !== "auto") return;
    let cleanup: (() => void) | undefined;
    let disposed = false;
    void listen<RouteTestSummary>("public-route-test-complete", (event) => {
      setTestSummary(event.payload);
      setProgress(null);
      void invoke<Route[]>("list_public_routes")
        .then(setRoutes)
        .catch(() => undefined);
    }).then((value) => {
      if (disposed) value(); else cleanup = value;
    });
    return () => { disposed = true; cleanup?.(); };
  }, [mode]);
  useEffect(() => {
    if (mode !== "auto") return;
    let cleanupProgress: (() => void) | undefined;
    let cleanupComplete: (() => void) | undefined;
    let disposed = false;
    void listen<RouteUpdateProgress>(
      "public-route-update-progress",
      (event) => {
        setUpdateProgress(event.payload);
      },
    ).then((value) => {
      if (disposed) value(); else cleanupProgress = value;
    });
    void listen<RouteUpdateSummary>("public-route-update-complete", (event) => {
      setUpdateSummary(event.payload);
      setUpdateProgress(null);
      void invoke<Route[]>("list_public_routes")
        .then(setRoutes)
        .catch(() => undefined);
    }).then((value) => {
      if (disposed) value(); else cleanupComplete = value;
    });
    return () => {
      disposed = true;
      cleanupProgress?.();
      cleanupComplete?.();
    };
  }, [mode]);
  const selectedRoute = routes.find((route) => route.id === routeId);
  const selectedRouteName =
    routeId == null
      ? "推荐线路优先"
      : selectedRoute
        ? routeDisplayName(selectedRoute, routes.findIndex((route) => route.id === selectedRoute.id))
        : "指定线路";
  const ownsConnection = state.mode === mode;
  const usableRoutes = routes.filter((route) => route.lastError == null);
  const failedRoutes = routes.length - usableRoutes.length;
  const latestSuccessAt = Math.max(0, ...routes.map((route) => route.lastSuccessAt ?? 0));
  const refreshRoutes = async () => {
    setRefreshingRoutes(true);
    setRouteRefreshMessage(null);
    try {
      const refreshed = await invoke<Route[]>("list_public_routes");
      setRoutes(refreshed);
      setRouteRefreshMessage(`已重新载入 ${refreshed.length} 条线路 · ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      setRouteRefreshMessage(`刷新线路失败：${String(error)}`);
    } finally {
      setRefreshingRoutes(false);
    }
  };
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
    const installImpact =
      core.coreId === "subs-check"
        ? "KiNGO 会保持当前代理连接完成下载；公共节点检测运行中不会替换 SubsCheck。"
        : "KiNGO 会保持代理完成下载，仅在最终替换正在使用的代理核心时短暂重连。";
    if (
      !window.confirm(
        `更新 ${core.name} 到 ${core.latestVersion ?? "最新版本"}？\n${installImpact}\n下载文件通过 SHA-256 校验后才会安装。`,
      )
    )
      return;
    setUpdatingCore(core.coreId);
    setCoreMessage(`正在下载并安装 ${core.name}…`);
    try {
      const result = await invoke<{
        version: string;
        checksumVerified: boolean;
        connectionRestarted: boolean;
      }>("update_core", { coreId: core.coreId });
      const installedVersion = result.version.replace(/^v/i, "");
      setCoreVersions(values => values.map(value => value.coreId === core.coreId ? {
        ...value,
        currentVersion: installedVersion,
        latestVersion: installedVersion,
        outdated: false,
        available: true,
        source: "user",
        error: null,
      } : value));
      setCoreMessage(
        `${core.name} 已更新至 ${result.version}${result.checksumVerified ? "，SHA-256 校验通过" : ""}${result.connectionRestarted ? "，正在恢复代理连接" : ""}`,
      );
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
    try {
      if (pendingAppUpdate.current) {
        await pendingAppUpdate.current.close().catch(() => undefined);
        pendingAppUpdate.current = null;
      }
      const update = await check({ timeout: 30_000 });
      pendingAppUpdate.current = update;
      if (update) {
        setAppUpdate({
          currentVersion: update.currentVersion,
          latestVersion: update.version,
          outdated: true,
          releaseUrl: "https://github.com/KINGHY02/KiNGO/releases/latest",
          notes: update.body ?? null,
          installable: true,
        });
      } else {
        const fallback = await invoke<AppUpdateInfo>("check_app_update");
        setAppUpdate({ ...fallback, installable: false });
      }
    } catch (error) {
      try {
        const fallback = await invoke<AppUpdateInfo>("check_app_update");
        setAppUpdate({ ...fallback, installable: false });
        setAppUpdateError(
          fallback.outdated
            ? "检测到新版本，但该版本没有可验证的软件内更新包，请等待发布方补齐更新文件。"
            : null,
        );
      } catch {
        setAppUpdateError(`检查软件更新失败：${String(error)}`);
      }
    }
    finally { setCheckingAppUpdate(false); }
  };
  const installAppUpdate = async () => {
    const update = pendingAppUpdate.current;
    if (!update || installingAppUpdate) return;
    setInstallingAppUpdate(true);
    setAppUpdateError(null);
    let downloaded = 0;
    let total: number | null = null;
    try {
      await update.download((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
          setAppUpdateProgress({ stage: "downloading", downloaded: 0, total, percent: 0 });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setAppUpdateProgress({
            stage: "downloading",
            downloaded,
            total,
            percent: total ? Math.min(100, Math.round(downloaded * 100 / total)) : null,
          });
        } else {
          setAppUpdateProgress({ stage: "preparing", downloaded, total, percent: 100 });
        }
      });
      setAppUpdateProgress({ stage: "preparing", downloaded, total, percent: 100 });
      await invoke("prepare_app_update");
      setAppUpdateProgress({ stage: "installing", downloaded, total, percent: 100 });
      await update.install();
      await relaunch();
    } catch (error) {
      setAppUpdateError(`软件更新失败：${String(error)}`);
      setAppUpdateProgress(null);
      setInstallingAppUpdate(false);
    }
  };
  useEffect(() => {
    if (page === "settings" && appUpdate == null && !checkingAppUpdate) {
      void checkAppUpdate();
    }
  }, [page]);
  const saveSpeedSettings = async (settings = speedSettings) => {
    setSpeedSettingsMessage(null);
    try { const saved = await invoke<SpeedTestSettings>("set_speed_test_settings", { settings }); setSpeedSettings(saved); setSpeedSettingsMessage("测速设置已保存"); }
    catch (error) { setSpeedSettingsMessage(`保存失败：${String(error)}`); }
  };
  const resetSpeedSettings = () => {
    const defaults = {
      ...DEFAULT_SPEED_TEST_SETTINGS,
      fallbackUrls: [...DEFAULT_SPEED_TEST_SETTINGS.fallbackUrls],
    };
    setSpeedSettings(defaults); void saveSpeedSettings(defaults);
  };
  const testSpeedEndpoint = async (kind: "latency" | "download") => {
    setSpeedSettingsMessage(null);
    setTestingSpeedUrl(kind);
    const url = kind === "latency" ? speedSettings.url : speedSettings.downloadUrl;
    try {
      const result = await invoke<SpeedTestUrlResult>("test_speed_test_url", {
        url,
        timeoutSeconds: speedSettings.timeoutSeconds,
      });
      setSpeedSettingsMessage(
        `${kind === "latency" ? "延迟" : "下载"}地址可用：HTTP ${result.status} · ${result.latencyMs} ms`,
      );
    } catch (error) {
      setSpeedSettingsMessage(
        `${kind === "latency" ? "延迟" : "下载"}地址不可用：${String(error)}`,
      );
    } finally {
      setTestingSpeedUrl(null);
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
  const toggleTun = async () => {
    setTunMessage(null);
    try {
      await invoke<AppState>("set_auto_tun", { enabled: !state.tunEnabled });
    } catch (error) {
      setTunMessage(String(error));
    }
  };
  if ((page as Page) === "settings")
    return (
      <div className="page workspace settings-page">
        <div className="settings-section">
          <div className="settings-section-heading"><div><b>界面与动效</b></div></div>
          <div className="settings-list">
            <section className="settings-card"><div><b>界面动效</b>{motionEnabled ? <p className="muted">按钮、主题和侧边栏使用轻微动效。</p> : <p className="muted">界面动效已关闭。</p>}</div><button className={motionEnabled ? "toggle on" : "toggle"} onClick={() => onMotionEnabled(!motionEnabled)} aria-label="界面动效"><i /></button></section>
            <section className="settings-card"><div><b>Windows 应用代理兼容</b><p className="muted">允许 Microsoft Store 应用访问本地代理。</p>{loopbackMessage && <small className="muted">{loopbackMessage}</small>}</div><button className="settings-action" onClick={() => void setupUwpLoopback()}>解除限制</button></section>
          </div>
        </div>
        <div className="settings-section speed-settings-section">
          <div className="settings-section-heading"><div><b>测速设置</b></div><div className="settings-heading-actions"><button className="settings-action" onClick={resetSpeedSettings}>恢复默认</button><button className="settings-action primary-button" onClick={() => void saveSpeedSettings()}>保存设置</button></div></div>
          <div className="speed-endpoint-list">
            <section className="speed-endpoint-card">
              <div className="speed-endpoint-heading"><div><b>延迟测速地址</b><small>用于线路延迟、可用性检测和自动选优。</small></div><button className="settings-action" disabled={testingSpeedUrl !== null} onClick={() => void testSpeedEndpoint("latency")}>{testingSpeedUrl === "latency" ? "测试中…" : "测试地址"}</button></div>
              <div className="speed-endpoint-row">
                <select
                  aria-label="延迟测速地址预设"
                  value={LATENCY_URL_PRESETS.some(item => item.url === speedSettings.url) ? speedSettings.url : "__custom__"}
                  onChange={(event) => {
                    if (event.target.value !== "__custom__") setSpeedSettings(value => ({ ...value, url: event.target.value }));
                  }}
                >
                  {LATENCY_URL_PRESETS.map(item => <option value={item.url} key={item.url}>{item.label}</option>)}
                  <option value="__custom__">自定义地址</option>
                </select>
                <input value={speedSettings.url} placeholder="https://www.gstatic.com/generate_204" onChange={(event) => setSpeedSettings(value => ({ ...value, url: event.target.value }))}/>
              </div>
              <div className="speed-fallback-block">
                <span>整批失败时依次备用</span>
                <div className="speed-fallbacks">
                  {LATENCY_URL_PRESETS.filter(item => item.url !== speedSettings.url).map(item => {
                    const checked = speedSettings.fallbackUrls.includes(item.url);
                    return <label key={item.url}><input type="checkbox" checked={checked} onChange={() => setSpeedSettings(value => ({ ...value, fallbackUrls: checked ? value.fallbackUrls.filter(url => url !== item.url) : [...value.fallbackUrls, item.url] }))}/><span>{item.label}</span></label>;
                  })}
                </div>
                <small>仅当本轮所有线路都失败时，才会让全部线路统一改用下一个地址重测，保证延迟排序公平。</small>
              </div>
            </section>
            <section className="speed-endpoint-card">
              <div className="speed-endpoint-heading"><div><b>下载测速地址</b><small>用于下载速度测试，与延迟选优互不影响。</small></div><button className="settings-action" disabled={testingSpeedUrl !== null} onClick={() => void testSpeedEndpoint("download")}>{testingSpeedUrl === "download" ? "测试中…" : "测试地址"}</button></div>
              <div className="speed-endpoint-row">
                <select
                  aria-label="下载测速地址预设"
                  value={DOWNLOAD_URL_PRESETS.some(item => item.url === speedSettings.downloadUrl) ? speedSettings.downloadUrl : "__custom__"}
                  onChange={(event) => {
                    if (event.target.value !== "__custom__") setSpeedSettings(value => ({ ...value, downloadUrl: event.target.value }));
                  }}
                >
                  {DOWNLOAD_URL_PRESETS.map(item => <option value={item.url} key={item.url}>{item.label}</option>)}
                  <option value="__custom__">自定义地址</option>
                </select>
                <input value={speedSettings.downloadUrl} placeholder="https://speed.cloudflare.com/__down?bytes=10000000" onChange={(event) => setSpeedSettings(value => ({ ...value, downloadUrl: event.target.value }))}/>
              </div>
            </section>
          </div>
          <div className="speed-settings-grid">
            <label><span>超时时间</span><select value={speedSettings.timeoutSeconds} onChange={(event) => setSpeedSettings(value => ({ ...value, timeoutSeconds: Number(event.target.value) }))}>{[2, 3, 4, 5, 8, 10, 15, 20, 30].map(value => <option value={value} key={value}>{value} 秒</option>)}</select><small>包括代理连接和目标地址响应时间。</small></label>
            <label><span>并发数量</span><select value={speedSettings.concurrency} onChange={(event) => setSpeedSettings(value => ({ ...value, concurrency: Number(event.target.value) }))}>{[1, 2, 3, 4, 6, 8, 10, 12].map(value => <option value={value} key={value}>{value} 个任务</option>)}</select><small>并发越高测速越快，但会占用更多核心进程和网络资源。</small></label>
          </div>
          {speedSettingsMessage && <div className={speedSettingsMessage.includes("失败") || speedSettingsMessage.includes("不可用") ? "settings-notice" : "settings-notice info"}>{speedSettingsMessage}</div>}
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
                <b>TUN 虚拟网卡</b>
                <p className="muted">接管不遵循系统代理的应用，并统一处理 DNS。</p>
                {tunMessage && (
                  <small className="settings-error">
                    {tunMessage}
                    {tunMessage.includes("管理员") && (
                      <button className="inline-admin-action" onClick={() => void invoke("restart_as_admin")}>管理员重启</button>
                    )}
                  </small>
                )}
              </div>
              <button
                className={state.tunEnabled ? "toggle on" : "toggle"}
                disabled={state.connecting}
                onClick={() => void toggleTun()}
                aria-label="TUN 虚拟网卡"
              >
                <i />
              </button>
            </section>
            <section className="settings-card">
              <div>
                <b>线路故障自动切换</b>
                <p className="muted">连接异常后自动尝试其他可用线路。</p>
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
                <p className="muted">断开或失败后恢复原 Windows 代理设置。</p>
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
                <p className="muted">后台持续验证代理请求是否可用。</p>
              </div>
              <span className="setting-status active">已启用</span>
            </section>
          </div>
        </div>
        <div className="settings-section core-manager">
          <div className="settings-section-heading">
            <div>
              <b>核心更新</b>
            </div>
            <button
              className="settings-action"
              disabled={
                checkingCores || updatingCore != null || state.connecting
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
                        state.connecting
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
                        state.connected ||
                        state.connecting
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
            <button className="settings-action" disabled={checkingAppUpdate || installingAppUpdate} onClick={() => void checkAppUpdate()}>
              {checkingAppUpdate ? <><LoadingOutlined spin /> 检查中</> : <><CloudDownloadOutlined /> 检查更新</>}
            </button>
          </div>
          <div className="app-version-row">
            <div><small>当前版本</small><b>v{appUpdate?.currentVersion ?? "2.0.4"}</b></div>
            <div><small>最新版本</small><b>{appUpdate?.latestVersion ? `v${appUpdate.latestVersion}` : "尚未检查"}</b></div>
            <span className={appUpdate?.outdated ? "core-status update" : "core-status ok"}>{appUpdate ? appUpdate.outdated ? "发现新版本" : "已是最新版本" : "等待检查"}</span>
            {appUpdate?.outdated && appUpdate.installable && (
              <button className="primary-button release-button" disabled={installingAppUpdate} onClick={() => void installAppUpdate()}>
                {installingAppUpdate ? <><LoadingOutlined spin /> 更新中</> : "立即更新"}
              </button>
            )}
            {appUpdate?.outdated && !appUpdate.installable && (
              <button className="release-button" onClick={() => void openUrl(appUpdate.releaseUrl)}>查看发布页</button>
            )}
          </div>
          {appUpdateProgress && (
            <div className="app-update-progress">
              <div>
                <span>{appUpdateProgress.stage === "downloading" ? "正在下载更新" : appUpdateProgress.stage === "preparing" ? "正在安全断开并准备安装" : "正在安装，KiNGO 将自动重启"}</span>
                <b>{appUpdateProgress.percent == null ? formatBytes(appUpdateProgress.downloaded) : `${appUpdateProgress.percent}%`}</b>
              </div>
              <progress max={100} value={appUpdateProgress.percent ?? undefined} />
              {appUpdateProgress.total != null && <small>{formatBytes(appUpdateProgress.downloaded)} / {formatBytes(appUpdateProgress.total)}</small>}
            </div>
          )}
          {appUpdate?.notes && <div className="app-update-notes"><b>更新说明</b><p>{appUpdate.notes}</p></div>}
          {appUpdateError && <div className="settings-notice">{appUpdateError}</div>}
        </div>
        <div className="settings-section about-card">
          <div className="about-heading"><img src={kingoLogo} alt="KiNGO"/><div><b>KiNGO</b><p>轻量网络连接桌面客户端</p></div></div>
          <div className="about-links">
            <button onClick={() => void openUrl("https://github.com/KINGHY02/KiNGO")}><GithubOutlined/><span>GitHub 项目主页</span></button>
            <button onClick={() => void openUrl("https://github.com/KINGHY02/KiNGO/releases")}><CloudDownloadOutlined/><span>版本发布与更新日志</span></button>
            <button onClick={() => void openUrl("https://t.me/kingovpn")}><TeamOutlined/><span>Telegram 用户群</span></button>
          </div>
          <div className="legal-block"><b><InfoCircleOutlined/> 版权与免责声明</b><p>Copyright © {new Date().getFullYear()} KINGHY02. All rights reserved.</p><p>本软件仅供学习、研究及个人合法使用，不提供任何代理服务。使用者应遵守所在国家或地区的法律法规，并自行承担因不当使用产生的责任。</p><small>作者：KINGHY02　·　项目：KiNGO　·　开源协议：MIT License</small></div>
        </div>
      </div>
    );
  if (page === "community") return <CommunityNodesPage state={state} />;
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
            <p className="muted">当前连接的实时状态</p>
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
            {routeRefreshMessage ?? (mode === "auto"
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
              : "功能区正在接入统一服务层")}
          </p>
        </div>
        <div className="toolbar-actions">
          {mode === "auto" && (
            <>
              <button
                className="primary-button"
                disabled={state.connected || updateProgress != null}
                onClick={() => {
                  setRouteRefreshMessage(null);
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
                disabled={state.connecting}
                onClick={() => {
                  if (updateProgress) {
                    void invoke("cancel_public_route_update");
                    return;
                  }
                  setRouteRefreshMessage(null);
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
                disabled={refreshingRoutes}
                onClick={() => void refreshRoutes()}
              >
                {refreshingRoutes ? "刷新中…" : "刷新列表"}
              </button>
            </>
          )}
        </div>
      </div>
      {mode === "auto" ? (
        <>
        <section className="route-overview route-overview-primary">
          <div>
            <span>当前策略</span>
            <b>{selectedRouteName}</b>
          </div>
          <div>
            <span>线路总数</span>
            <b>{routes.length || 0}</b>
          </div>
          <div>
            <span>可用 / 失败</span>
            <b>{usableRoutes.length} 可用 · {failedRoutes} 失败</b>
          </div>
          <div>
            <span>最近测试</span>
            <b>{latestSuccessAt ? formatRouteTime(latestSuccessAt) : "尚未测试"}</b>
          </div>
          <button disabled={state.connecting || routeId == null} onClick={() => onRoute("")}>
            使用推荐线路
          </button>
        </section>
        <div className="route-list modern-route-list">
          <div className="route-table-head">
            <span>#</span>
            <span>线路</span>
            <span>状态</span>
            <span>延迟</span>
            <span>操作</span>
          </div>
          {routes.map((route, index) => {
            const testing = progress?.routeId === route.id && state.connecting;
            const selected = routeId === route.id;
            const failed = route.lastError != null;
            const tunCompatible = route.coreId === "mihomo" || route.coreId === "sing-box";
            const status = testing
              ? "测速中"
              : failed
                ? route.lastError?.includes("核心") ? "核心失败" : "连接失败"
                : route.active
                  ? "正在使用"
                  : route.lastSuccessAt
                    ? route.successRate != null
                      ? `${route.quality} · ${route.successRate}%`
                      : `可用 · ${formatRouteTime(route.lastSuccessAt)}`
                    : "待测试";
            return (
              <div
                className={route.active ? "route-row route-selected route-active" : selected ? "route-row route-selected" : failed ? "route-row route-failed" : "route-row"}
                key={route.id}
                title={route.lastError ?? (state.tunEnabled && !tunCompatible
                  ? "该线路核心暂不支持原生 TUN"
                  : route.jitter != null
                    ? `延迟波动约 ${route.jitter} ms · 最近成功率 ${route.successRate ?? 0}% · 最近可用 ${route.lastSuccessAt ? formatRouteTime(route.lastSuccessAt) : "未知"}`
                    : undefined)}
              >
                <span className="route-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <b>{routeDisplayName(route, index)}</b>
                <span className={failed ? "route-status failed" : testing ? "route-status testing" : "route-status ok"}>
                  {status}
                </span>
                <span
                  className={failed ? "delay-pill failed" : "delay-pill"}
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
                  <button disabled={state.connecting || route.active || (state.tunEnabled && !tunCompatible)} onClick={() => onRoute(route.id)}>
                    {state.tunEnabled && !tunCompatible ? "不支持" : route.active ? "当前" : selected ? "已选" : state.connected && state.mode === "auto" ? "切换" : "使用"}
                  </button>
                </div>
              </div>
            );
          })}
          {failedRoutes > 0 && <div className="route-list-footer">有 {failedRoutes} 条线路不可用，鼠标悬停失败线路可查看完整原因。</div>}
        </div>
        </>
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
