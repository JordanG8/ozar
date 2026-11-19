import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./icons";
import ui from "./ui.module.css";

export function TopBar({ back = "/", backLabel = "חזרה", title, children }: {
  back?: string; backLabel?: string; title?: ReactNode; children?: ReactNode;
}) {
  return (
    <header className={ui.bar}>
      <Link className={ui.iconButton} href={back} aria-label={backLabel}><Icon name="back" /></Link>
      <h1 className={ui.barTitle}>{title}</h1>
      {children}
    </header>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className={ui.section}>{children}</h2>;
}

export function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return <div className={ui.empty}><h2>{title}</h2>{children}</div>;
}
