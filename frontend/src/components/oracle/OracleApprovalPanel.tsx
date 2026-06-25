"use client";

export interface ApprovalAction {
  action: string;
  label: string;
  count: number;
  cad_ids?: string[];
}

export interface ApprovalItem {
  id: string;
  name: string;
  detail: string;
}

export interface PendingApproval {
  description: string;
  items?: ApprovalItem[];
  actions: ApprovalAction[];
}

interface OracleApprovalPanelProps {
  pendingApproval: PendingApproval;
  onAction: (action: ApprovalAction) => void;
  busy?: boolean;
}

/**
 * Panel approval generik — render aksi secara DINAMIS dari array `actions`
 * (bukan 3 tombol Setujui/Review/Tolak yang fixed), karena bentuk approval
 * nyata di backend (mis. validate-cad: dismiss_false_alarms/confirm_genuine)
 * jumlah dan labelnya bervariasi per konteks, bukan selalu 3 pilihan tetap.
 */
export function OracleApprovalPanel({ pendingApproval, onAction, busy }: OracleApprovalPanelProps) {
  return (
    <div className="border border-yellow-200 dark:border-yellow-900 rounded-lg p-4 bg-yellow-50 dark:bg-yellow-950/20">
      <div className="flex items-center gap-2 mb-3">
        <span>⚠️</span>
        <span className="text-sm font-medium">ORACLE membutuhkan persetujuan Anda</span>
      </div>

      <p className="text-sm text-muted-foreground mb-3">{pendingApproval.description}</p>

      {pendingApproval.items && pendingApproval.items.length > 0 && (
        <div className="text-xs space-y-1 mb-3 max-h-32 overflow-y-auto">
          {pendingApproval.items.slice(0, 5).map((item) => (
            <div key={item.id} className="flex justify-between gap-2">
              <span className="truncate">{item.name}</span>
              <span className="text-muted-foreground shrink-0">{item.detail}</span>
            </div>
          ))}
          {pendingApproval.items.length > 5 && (
            <span className="text-muted-foreground">+{pendingApproval.items.length - 5} lainnya</span>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {pendingApproval.actions.map((action) => (
          <button
            key={action.action}
            disabled={busy || action.count === 0}
            onClick={() => onAction(action)}
            className="flex-1 min-w-[140px] text-xs bg-primary text-primary-foreground rounded px-3 py-1.5
              hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
