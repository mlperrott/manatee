export const directionLabels: Readonly<Record<string, string>> = {
  TB: "Top to bottom",
  BT: "Bottom to top",
  LR: "Left to right",
  RL: "Right to left",
};

export const flowShapeLabels: Readonly<Record<string, string>> = {
  rectangle: "▭ Rectangle",
  square: "□ Square",
  round: "▢ Rounded rectangle",
  stadium: "▱ Pill",
  diamond: "◇ Decision",
  hexagon: "⬡ Hexagon",
  circle: "○ Circle",
  doublecircle: "◎ Double circle",
  subroutine: "▣ Subroutine",
  cylinder: "◉ Database",
  ellipse: "⬭ Ellipse",
  lean_right: "▱ Slanted right",
  lean_left: "▱ Slanted left",
  trapezoid: "⏢ Trapezoid",
  inv_trapezoid: "⏢ Inverted trapezoid",
  rect: "▭ Rectangle",
  odd: "▹ Asymmetric",
};

export const connectionKindLabels: Readonly<Record<string, string>> = {
  arrow_point: "Arrow",
  arrow_open: "Line",
  arrow_circle: "Circle endpoint",
  arrow_cross: "Cross endpoint",
  double_arrow_point: "Arrow at both ends",
  double_arrow_circle: "Circle at both ends",
  double_arrow_cross: "Cross at both ends",
  rel: "Relationship",
  birel: "Relationship both ways",
  rel_b: "Reverse relationship",
};
