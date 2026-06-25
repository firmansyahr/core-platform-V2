"use client";

import { Loader2 } from "lucide-react";

export interface ActiveTaskState {
  task_id: string;
  task_name: string;
  steps: { description: string }[];
  steps_completed: number;
  steps_total: number;
}

interface OracleTaskProgressProps {
  activeTask: ActiveTaskState;
  onCancel: () => void;
}

export function OracleTaskProgress({ activeTask, onCancel }: OracleTaskProgressProps) {
  const pct = activeTask.steps_total > 0 ? (activeTask.steps_completed / activeTask.steps_total) * 100 : 0;

  return (
    <div className="border border-border rounded-lg p-4 bg-muted/30">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium">🤖 {activeTask.task_name}</span>
        <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-destructive transition-colors">
          Batalkan
        </button>
      </div>

      <div className="space-y-2">
        {activeTask.steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            {i < activeTask.steps_completed && <span>✅</span>}
            {i === activeTask.steps_completed && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
            {i > activeTask.steps_completed && <span className="text-muted-foreground">⬜</span>}
            <span className={i < activeTask.steps_completed ? "text-muted-foreground line-through" : ""}>
              {step.description}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 bg-muted rounded-full h-1.5 overflow-hidden">
        <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
