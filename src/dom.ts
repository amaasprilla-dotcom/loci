// A small helper for building DOM elements without a framework.
//   h('button', { class: 'fab', onclick: () => ... }, '+')
// Props starting with "on" become event listeners; "style" takes an object of CSS properties
// (custom properties like "--c" work too); everything else is set as an attribute.

type Child = Node | string | null | undefined | false
type Props = Record<string, unknown> & { style?: Record<string, string> }

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue
    if (key === 'style') {
      for (const [prop, v] of Object.entries(value as Record<string, string>)) el.style.setProperty(prop, v)
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value as EventListener)
    } else {
      el.setAttribute(key, value === true ? '' : String(value))
    }
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue
    el.append(child)
  }
  return el
}
