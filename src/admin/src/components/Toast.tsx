import { CheckCircle2, Info, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { ToastState } from "../hooks/useAdminData";

interface ToastProps {
  toast?: ToastState;
}

export function Toast({ toast }: ToastProps) {
  const Icon = toast?.kind === "error" ? XCircle : toast?.kind === "info" ? Info : CheckCircle2;

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          className={`toast ${toast.kind}`}
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          transition={{ duration: 0.2 }}
        >
          <Icon size={17} />
          <span>{toast.text}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
