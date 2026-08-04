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
  | "connections"
  | "logs"
  | "settings";
export type AppState = {
  mode: string;
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
  const [appVersion, setAppVersion] = useState("2.0.3");
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
  onRefresh: () => void;
  onNavigate: (page: Page) => void;
}) {
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
            {state.connected && <button onClick={onRefresh} disabled={state.connecting}>刷新出口 IP</button>}
            {state.connected && <button onClick={() => onNavigate("connections")}>连接详情</button>}
          </div>}
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
      ? "推荐线路优先"
      : selectedRoute
        ? routeDisplayName(selectedRoute, routes.findIndex((route) => route.id === selectedRoute.id))
        : "指定线路";
  const ownsConnection = state.mode === mode;
  const usableRoutes = routes.filter((route) => route.lastError == null);
  const failedRoutes = routes.length - usableRoutes.length;
  const latestSuccessAt = Math.max(0, ...routes.map((route) => route.lastSuccessAt ?? 0));
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
            <button className="settings-action" disabled={checkingAppUpdate || installingAppUpdate} onClick={() => void checkAppUpdate()}>
              {checkingAppUpdate ? <><LoadingOutlined spin /> 检查中</> : <><CloudDownloadOutlined /> 检查更新</>}
            </button>
          </div>
          <div className="app-version-row">
            <div><small>当前版本</small><b>v{appUpdate?.currentVersion ?? "2.0.3"}</b></div>
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
