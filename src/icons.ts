// Small line icons, drawn in currentColor. Original, made for this project.

function icon(paths: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.innerHTML = paths
  return svg
}

const stroke = (width = 2) => `fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`
const STROKE = stroke()

export const backIcon = () => icon(`<path d="M15 5l-7 7 7 7" ${stroke(2.4)}/>`)

// Three sliders: settings.
export const settingsIcon = () =>
  icon(
    `<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" ${STROKE}/><circle cx="15" cy="6" r="2" ${STROKE}/><circle cx="9" cy="12" r="2" ${STROKE}/><circle cx="17" cy="18" r="2" ${STROKE}/>`,
  )
