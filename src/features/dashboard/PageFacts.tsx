import type { ComponentType } from "react";

/*
 * A page's sentence as three facts across its header card, each with its
 * glyph (owner, 17 Oct 2026: first on Accounts, then on every page). The
 * words are the sentence's own, split where it already breaks; the header
 * takes `view-header--facts` and puts its actions at the card's foot.
 */
export type PageFact = {
  icon: ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>;
  text: string;
};

export function PageFacts({ facts }: { facts: PageFact[] }) {
  return (
    <ul className="view-header__facts">
      {facts.map(({ icon: Icon, text }) => (
        <li key={text}>
          <Icon aria-hidden size={16} strokeWidth={2} />
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}
