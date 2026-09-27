// Read-only function passed to the browser tool; no DOM or app-state writes.
export const collectRenderedStyles = (specs) => {
  const box = (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  const style = (e, pseudo) => {
    const c = getComputedStyle(e, pseudo);
    return {
      color: c.color,
      backgroundColor: c.backgroundColor,
      backgroundImage: c.backgroundImage,
      opacity: c.opacity,
      fontSize: c.fontSize,
      fontWeight: c.fontWeight,
      lineHeight: c.lineHeight,
      textShadow: c.textShadow,
      filter: c.filter,
      backdropFilter: c.backdropFilter,
      mixBlendMode: c.mixBlendMode,
      visibility: c.visibility,
      display: c.display,
    };
  };
  return {
    recordedAt: new Date().toISOString(),
    url: location.href,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    samples: specs.map((spec) => {
      let candidates = Array.from(document.querySelectorAll(spec.selector));
      if (spec.text) candidates = candidates.filter((e) => e.textContent?.includes(spec.text));
      const e = candidates[spec.index ?? 0];
      if (!e) throw new Error(`Missing ${spec.id}`);
      const rect = e.getBoundingClientRect();
      const ancestors = [];
      for (let n = e; n; n = n.parentElement) {
        ancestors.push({
          tag: n.tagName,
          id: n.id,
          className: String(n.className),
          rect: box(n.getBoundingClientRect()),
          style: style(n),
        });
      }
      return {
        ...spec,
        text: spec.pseudo ? e.getAttribute("placeholder") : e.textContent?.trim(),
        matched: candidates.length,
        rect: box(rect),
        intersectsViewport:
          rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth,
        style: style(e, spec.pseudo),
        ancestors,
      };
    }),
  };
};
