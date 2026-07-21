import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth, type SavedAccount } from "@/hooks/use-auth";
import { useGetUser } from "@workspace/api-client-react";
import { ChevronUp, UserPlus, LogOut, Check, X } from "lucide-react";

// Palette cycling per account
const AVATAR_GRADIENTS = [
  "from-indigo-500 to-violet-600",
  "from-emerald-500 to-teal-600",
  "from-rose-500 to-pink-600",
  "from-amber-500 to-orange-600",
  "from-sky-500 to-blue-600",
  "from-fuchsia-500 to-purple-600",
];

function avatarGradient(userId: number) {
  return AVATAR_GRADIENTS[userId % AVATAR_GRADIENTS.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Avatar({ account, size = "md" }: { account: SavedAccount; size?: "sm" | "md" | "lg" }) {
  const sz = size === "lg" ? "w-10 h-10 text-sm" : size === "sm" ? "w-7 h-7 text-[10px]" : "w-8 h-8 text-xs";
  const label = account.name ? initials(account.name) : "?";
  return (
    <div className={`${sz} rounded-full bg-gradient-to-br ${avatarGradient(account.userId)} flex items-center justify-center font-bold text-white shrink-0 ring-2 ring-background`}>
      {label}
    </div>
  );
}

// Syncs the logged-in user's name/phone into the saved accounts list
function AccountMetaSync({ userId }: { userId: number }) {
  const { updateCurrentAccountMeta } = useAuth();
  const { data: user } = useGetUser(userId, { query: { enabled: true } });
  useEffect(() => {
    if (user?.name) {
      updateCurrentAccountMeta(user.name, user.fullPhone ?? user.phoneNumber ?? "");
    }
  }, [user, updateCurrentAccountMeta]);
  return null;
}

export function AccountSwitcher() {
  const [, setLocation] = useLocation();
  const { userId, savedAccounts, switchAccount, addAccountSlot, removeAccount, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const currentAccount = savedAccounts.find(a => a.userId === userId);
  const otherAccounts = savedAccounts.filter(a => a.userId !== userId);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmRemove(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSwitch = (id: number) => {
    switchAccount(id);
    setOpen(false);
    setLocation("/dashboard");
  };

  const handleAddAccount = () => {
    addAccountSlot();          // preserves saved accounts, clears active userId
    setOpen(false);
    setLocation("/");          // landing page
  };

  const handleSignOut = () => {
    logout();
    setOpen(false);
    setLocation("/");
  };

  const handleRemove = (id: number) => {
    if (confirmRemove === id) {
      removeAccount(id);
      setConfirmRemove(null);
      if (id === userId) setLocation("/");
    } else {
      setConfirmRemove(id);
    }
  };

  return (
    <>
      {/* Sync current user's name/phone into savedAccounts */}
      {userId !== null && <AccountMetaSync userId={userId} />}

      <div ref={panelRef} className="relative">
        {/* Slide-up panel */}
        <div
          className={`absolute bottom-full left-0 right-0 mb-1 overflow-hidden rounded-xl border border-border/70 bg-sidebar shadow-2xl shadow-black/40 transition-all duration-200 origin-bottom ${
            open ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"
          }`}
          style={{ transformOrigin: "bottom center" }}
        >
          {/* Other accounts */}
          {otherAccounts.length > 0 && (
            <div className="p-2 space-y-1">
              <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/60 px-2 pt-1 pb-0.5">
                SWITCH ACCOUNT
              </p>
              {otherAccounts.map(account => (
                <div
                  key={account.userId}
                  className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-secondary/70 transition-colors group"
                >
                  <button
                    onClick={() => handleSwitch(account.userId)}
                    className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                  >
                    <Avatar account={account} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate leading-tight">
                        {account.name || `Account ${account.userId}`}
                      </p>
                      {account.phone && (
                        <p className="text-[11px] text-muted-foreground truncate leading-tight">{account.phone}</p>
                      )}
                    </div>
                  </button>

                  {/* Remove button */}
                  {confirmRemove === account.userId ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[10px] text-rose-400 whitespace-nowrap">Remove?</span>
                      <button
                        onClick={() => handleRemove(account.userId)}
                        className="p-1 rounded text-rose-400 hover:bg-rose-500/20 transition-colors"
                        title="Confirm remove"
                      >
                        <Check size={12} />
                      </button>
                      <button
                        onClick={() => setConfirmRemove(null)}
                        className="p-1 rounded text-muted-foreground hover:bg-secondary transition-colors"
                        title="Cancel"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleRemove(account.userId)}
                      className="p-1 rounded text-muted-foreground/40 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                      title="Remove account"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {otherAccounts.length > 0 && (
            <div className="border-t border-border/50 mx-3" />
          )}

          {/* Add account + Sign out */}
          <div className="p-2 space-y-0.5">
            <button
              onClick={handleAddAccount}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors text-sm font-medium"
            >
              <UserPlus size={15} className="text-indigo-400" />
              <span>Add account</span>
            </button>
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 transition-colors text-sm font-medium"
            >
              <LogOut size={15} />
              <span>Sign out</span>
            </button>
          </div>
        </div>

        {/* Current account trigger row */}
        <button
          onClick={() => { setOpen(v => !v); setConfirmRemove(null); }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-secondary/60 transition-colors group"
        >
          {currentAccount ? (
            <Avatar account={currentAccount} size="sm" />
          ) : (
            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
              <span className="text-[10px] text-muted-foreground">?</span>
            </div>
          )}
          <div className="flex-1 min-w-0 text-left">
            <p className="text-sm font-semibold text-foreground truncate leading-tight">
              {currentAccount?.name || "My Account"}
            </p>
            {currentAccount?.phone && (
              <p className="text-[11px] text-muted-foreground truncate leading-tight">{currentAccount.phone}</p>
            )}
          </div>
          <ChevronUp
            size={15}
            className={`text-muted-foreground transition-transform duration-200 shrink-0 ${open ? "rotate-0" : "rotate-180"}`}
          />
        </button>
      </div>
    </>
  );
}
