export type ProgressStep = {
  id: string;
  label: string;
  status: "pending" | "active" | "done";
};

type ProgressStepsProps = {
  steps: ProgressStep[];
  currentMessage?: string | null;
};

export function ProgressSteps({ steps, currentMessage }: ProgressStepsProps) {
  return (
    <div className="progress">
      <div className="progress__header">
        <p className="progress__title">Analysis progress</p>
        {currentMessage ? <p className="progress__message">{currentMessage}</p> : null}
      </div>
      <ul className="progress__list">
        {steps.map((step) => (
          <li key={step.id} className={`progress__item status-${step.status}`}>
            <span className="progress__dot" />
            <span className="progress__label">{step.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
