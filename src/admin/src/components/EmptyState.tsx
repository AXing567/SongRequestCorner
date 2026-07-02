import { AudioLines } from "lucide-react";
import { motion } from "framer-motion";

interface EmptyStateProps {
  title: string;
  detail: string;
}

export function EmptyState({ title, detail }: EmptyStateProps) {
  return (
    <motion.div
      className="empty-state"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22 }}
    >
      <AudioLines size={24} />
      <strong>{title}</strong>
      <span>{detail}</span>
    </motion.div>
  );
}
