import { PlayMenu } from "./PlayMenu";
import { StatusPanel } from "./StatusPanel";
import { VizContainer } from "./VizContainer";

// The Listen panel. It persists in the DOM permanently — visibility is
// class-only, driven by the shell.
export function ListenPanel({ visible }: { visible: boolean }) {
  return (
    <section
      className={visible ? "panel tab-panel" : "panel tab-panel hidden"}
      data-tab-panel="play"
    >
      <StatusPanel />
      <PlayMenu />
      <VizContainer />
    </section>
  );
}
