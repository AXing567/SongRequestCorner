import type { Variants } from "framer-motion";

export const spring = {
  type: "spring",
  stiffness: 420,
  damping: 34,
  mass: 0.8
} as const;

export const softEase = [0.22, 1, 0.36, 1] as const;

export const panelEntrance: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.24, ease: softEase }
  }
};

export const listItemMotion: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.22, ease: softEase }
  },
  exit: {
    opacity: 0,
    x: 22,
    transition: { duration: 0.18, ease: softEase }
  }
};

export const dangerExit: Variants = {
  exit: {
    opacity: 0,
    x: 26,
    transition: { duration: 0.18, ease: softEase }
  }
};

export const listSwitchMotion: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.18, ease: softEase }
  },
  exit: {
    opacity: 0,
    y: 6,
    transition: { duration: 0.14, ease: softEase }
  }
};

export const buttonTap = {
  scale: 0.96,
  y: 1
};
