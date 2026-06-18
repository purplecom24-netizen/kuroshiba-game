// Top bar: trading mode, data source, and live connection state.
// Surfaces the spec §2 safety posture at a glance (paper vs live, armed or not).

export default function StatusBar({ status, connection }) {
  const mode = status?.trading_mode ?? "…";
  const armed = status?.live_orders_armed;
  const source = status?.data_source ?? "…";

  return (
    <header className="statusbar">
      <div className="brand">
        🐕 Kuroshiba <span className="muted">semi-auto trading</span>
      </div>
      <div className="status-chips">
        <span className={`chip mode mode-${mode}`}>MODE: {mode}</span>
        <span className={`chip ${armed ? "danger" : "safe"}`}>
          {armed ? "LIVE ORDERS ARMED" : "live disarmed"}
        </span>
        <span className="chip">data: {source}</span>
        <span className={`chip dot dot-${connection}`}>{connection}</span>
      </div>
    </header>
  );
}
