function setButtonActive(btn: Element, active: boolean): void {
  btn.classList.toggle('text-yellow-600', active)
  btn.classList.toggle('dark:text-yellow-400', active)
}

function positionPanel(
  panel: HTMLElement,
  btnRect: DOMRect,
  menu: HTMLElement,
  iframe: HTMLIFrameElement,
): void {
  const { contentWindow } = iframe
  if (!contentWindow) throw new Error('iframe contentWindow unavailable')
  const menuRect = menu.getBoundingClientRect()
  const { innerWidth, innerHeight } = contentWindow
  const onLeft = menuRect.left < innerWidth / 2
  const panelHeight = panel.offsetHeight || 200

  if (btnRect.top + panelHeight + 16 > innerHeight) {
    panel.style.top = ''
    panel.style.bottom = innerHeight - btnRect.bottom + 'px'
  } else {
    panel.style.top = btnRect.top + 'px'
    panel.style.bottom = ''
  }

  const gap = 8
  if (onLeft) {
    panel.style.left = menuRect.right + gap + 'px'
    panel.style.right = ''
  } else {
    panel.style.left = ''
    panel.style.right = innerWidth - menuRect.left + gap + 'px'
  }
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  )
}

function createPanel(
  panel: HTMLElement,
  button: HTMLElement,
  menu: HTMLElement,
  iframe: HTMLIFrameElement,
  closeSiblings: () => void,
  onOpen?: () => void,
) {
  let isOpen = false
  let trapHandler: ((e: KeyboardEvent) => void) | null = null
  const doc = panel.ownerDocument

  function position(): void {
    positionPanel(panel, button.getBoundingClientRect(), menu, iframe)
  }

  function open(): void {
    closeSiblings()
    isOpen = true
    setButtonActive(button, true)
    position()
    panel.style.opacity = '1'
    panel.removeAttribute('inert')
    getFocusable(panel)[0]?.focus()

    trapHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusable = getFocusable(panel)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey) {
        if (doc.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (doc.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    doc.addEventListener('keydown', trapHandler)
    onOpen?.()
  }

  function close(): void {
    if (!isOpen) return
    isOpen = false
    setButtonActive(button, false)
    panel.style.opacity = '0'
    panel.setAttribute('inert', '')
    if (trapHandler) {
      doc.removeEventListener('keydown', trapHandler)
      trapHandler = null
    }
    if (panel.contains(doc.activeElement)) button.focus()
  }

  return { open, close, isOpen: () => isOpen, position }
}

function setupTabs(doc: Document, tabClass: string, contentIdPrefix: string): void {
  doc.querySelectorAll<HTMLElement>(`.${tabClass}`).forEach((tab) => {
    tab.addEventListener('click', () => {
      doc
        .querySelectorAll<HTMLElement>(`.${tabClass}`)
        .forEach((t) => t.setAttribute('aria-selected', 'false'))
      tab.setAttribute('aria-selected', 'true')
      doc.querySelectorAll(`.${tabClass}-content`).forEach((c) => c.classList.add('hidden'))
      doc.getElementById(`${contentIdPrefix}-${tab.dataset.tab}`)?.classList.remove('hidden')
    })
  })
}

export function createPanelManager(deps: {
  doc: Document
  iframe: HTMLIFrameElement
  menu: HTMLElement
  collapsable: HTMLElement
  collapseIcon: HTMLElement
  menuBg: HTMLElement
  typographyPanel: HTMLElement
  settingsPanel: HTMLElement
  themePanel: HTMLElement
  exportPanel: HTMLElement
  btnTypography: HTMLElement
  btnSettings: HTMLElement
  btnThemeToggle: HTMLElement
  btnExport: HTMLElement
  btnCollapse: HTMLElement
  onClosePopover: () => void
}) {
  const {
    doc,
    iframe,
    menu,
    collapsable,
    collapseIcon,
    menuBg,
    typographyPanel,
    settingsPanel,
    themePanel,
    exportPanel,
    btnTypography,
    btnSettings,
    btnThemeToggle,
    btnExport,
    btnCollapse,
    onClosePopover,
  } = deps

  const { contentWindow } = iframe
  if (!contentWindow) throw new Error('iframe contentWindow unavailable')

  const typography = createPanel(typographyPanel, btnTypography, menu, iframe, () => {
    settings.close()
    theme.close()
    exporter.close()
    onClosePopover()
  })
  const settings = createPanel(settingsPanel, btnSettings, menu, iframe, () => {
    typography.close()
    theme.close()
    exporter.close()
    onClosePopover()
  })
  const theme = createPanel(themePanel, btnThemeToggle, menu, iframe, () => {
    typography.close()
    settings.close()
    exporter.close()
    onClosePopover()
  })
  const exporter = createPanel(exportPanel, btnExport, menu, iframe, () => {
    typography.close()
    settings.close()
    theme.close()
    onClosePopover()
  })

  setupTabs(doc, 'settings-tab', 'settingsTab')
  setupTabs(doc, 'typography-tab', 'typographyTab')
  setupTabs(doc, 'theme-tab', 'themeTab')

  const bindPanelToggle = (btn: HTMLElement, panel: ReturnType<typeof createPanel>) =>
    btn.addEventListener('click', () => (panel.isOpen() ? panel.close() : panel.open()))

  bindPanelToggle(btnTypography, typography)
  bindPanelToggle(btnSettings, settings)
  bindPanelToggle(btnThemeToggle, theme)
  bindPanelToggle(btnExport, exporter)

  let isCollapsed = false
  const collapsePaths = collapseIcon.querySelectorAll('path')
  const CHEVRON_D = ['M4.5 18.75 l7.5 -7.5 l7.5 7.5', 'M4.5 12.75 l7.5 -7.5 l7.5 7.5']
  const HAMBURGER_D = ['M4.5 15 l7.5 0 l7.5 0', 'M4.5 9 l7.5 0 l7.5 0']

  function setCollapsed(next: boolean, animate: boolean): void {
    if (next === isCollapsed) return
    isCollapsed = next
    if (!animate) {
      collapsable.style.transition = 'none'
      menuBg.style.transition = 'none'
    }
    if (!next) menu.classList.remove('h-[4.5rem]')
    if (next) collapsable.setAttribute('inert', '')
    else collapsable.removeAttribute('inert')
    collapsable.classList.toggle('-translate-y-full', next)
    collapsable.classList.toggle('opacity-0', next)
    collapsable.classList.toggle('blur-xs', next)
    menuBg.classList.toggle('-translate-y-[calc(6*3.5rem)]', next)
    const paths = next ? HAMBURGER_D : CHEVRON_D
    collapsePaths.forEach((p, i) => p.setAttribute('d', paths[i]))
    btnCollapse.dataset.tooltip = next ? 'Expand menu' : 'Collapse menu'
    if (!animate) {
      if (next) menu.classList.add('h-[4.5rem]')
      void collapsable.offsetWidth
      collapsable.style.transition = ''
      menuBg.style.transition = ''
    }
  }

  collapsable.addEventListener('transitionend', () => {
    menu.classList.toggle('h-[4.5rem]', isCollapsed)
  })

  btnCollapse.addEventListener('click', () => {
    typography.close()
    settings.close()
    theme.close()
    exporter.close()
    setCollapsed(!isCollapsed, true)
    void chrome.storage.local.set({ 'booklike-menu-collapsed': isCollapsed })
  })

  chrome.storage.local.get(
    ['booklike-menu-pos', 'booklike-menu-collapsed'],
    (result: { 'booklike-menu-pos'?: { x: number; y: number }; 'booklike-menu-collapsed'?: boolean }) => {
      const pos = result['booklike-menu-pos']
      if (pos) {
        const { x, y } = pos
        const { innerWidth, innerHeight } = contentWindow
        const pad = 16
        const px = Math.max(pad, Math.min(x * innerWidth, innerWidth - menu.offsetWidth - pad))
        const py = Math.max(pad, Math.min(y * innerHeight, innerHeight - menu.offsetHeight - pad))
        menu.style.left = px + 'px'
        menu.style.top = py + 'px'
      }
      if (result['booklike-menu-collapsed']) setCollapsed(true, false)
    },
  )

  let isDragging = false
  let offsetX = 0
  let offsetY = 0

  menu.addEventListener('mousedown', (e) => {
    if ((e.target as Element).closest('button')) return
    e.preventDefault()
    isDragging = true
    menu.style.cursor = 'grabbing'
    doc.body.style.userSelect = 'none'
    const rect = menu.getBoundingClientRect()
    offsetX = e.clientX - rect.left
    offsetY = e.clientY - rect.top
  })

  doc.addEventListener('mousemove', (e) => {
    if (!isDragging) return
    const menuRect = menu.getBoundingClientRect()
    const { innerWidth, innerHeight } = contentWindow
    const pad = 16
    let x = e.clientX - offsetX
    let y = e.clientY - offsetY
    x = Math.max(pad, Math.min(x, innerWidth - menuRect.width - pad))
    y = Math.max(pad, Math.min(y, innerHeight - menuRect.height - pad))
    menu.style.left = x + 'px'
    menu.style.top = y + 'px'
    if (typography.isOpen()) typography.position()
    if (settings.isOpen()) settings.position()
    if (theme.isOpen()) theme.position()
    if (exporter.isOpen()) exporter.position()
  })

  doc.addEventListener('mouseup', () => {
    if (!isDragging) return
    isDragging = false
    menu.style.cursor = 'grab'
    doc.body.style.userSelect = ''
    const { innerWidth, innerHeight } = contentWindow
    const x = parseFloat(menu.style.left) / innerWidth
    const y = parseFloat(menu.style.top) / innerHeight
    if (!isNaN(x) && !isNaN(y)) {
      void chrome.storage.local.set({ 'booklike-menu-pos': { x, y } })
    }
  })

  const panelEntries = [
    { panel: typography, el: typographyPanel },
    { panel: settings, el: settingsPanel },
    { panel: theme, el: themePanel },
    { panel: exporter, el: exportPanel },
  ]

  doc.addEventListener(
    'mousedown',
    (e) => {
      const target = e.target as Element
      panelEntries.forEach(({ panel, el }) => {
        if (panel.isOpen() && !menu.contains(target) && !el.contains(target)) panel.close()
      })
    },
    { capture: true },
  )

  const tooltip = doc.createElement('div')
  tooltip.className =
    'fixed z-100 pointer-events-none bg-stone-900 dark:bg-black text-white font-sans text-xs px-2 py-1 rounded-md whitespace-nowrap transition-opacity duration-150 motion-reduce:duration-0'
  tooltip.style.opacity = '0'
  const caret = doc.createElement('div')
  caret.className = 'absolute top-1/2 size-0 border-5 border-transparent -translate-y-1/2'
  tooltip.appendChild(caret)
  doc.body.appendChild(tooltip)

  let tooltipTimer: ReturnType<typeof setTimeout> | null = null

  menu.addEventListener('mouseover', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('button[data-tooltip]')
    if (!btn || (btn as HTMLButtonElement).disabled) {
      tooltip.style.opacity = '0'
      return
    }
    if (
      (btn === btnTypography && typography.isOpen()) ||
      (btn === btnSettings && settings.isOpen()) ||
      (btn === btnThemeToggle && theme.isOpen())
    ) {
      tooltip.style.opacity = '0'
      return
    }
    if (tooltipTimer) clearTimeout(tooltipTimer)
    tooltipTimer = setTimeout(() => {
      const text = btn.dataset.tooltip ?? ''
      tooltip.childNodes.forEach((n, i) => {
        if (i > 0) n.remove()
      })
      tooltip.appendChild(doc.createTextNode(text))

      const btnRect = btn.getBoundingClientRect()
      const menuRect = menu.getBoundingClientRect()
      const { innerWidth } = contentWindow
      const showRight = menuRect.left < contentWindow.innerWidth / 2

      tooltip.style.top = btnRect.top + btnRect.height / 2 + 'px'
      tooltip.style.transform = 'translateY(-50%)'
      if (showRight) {
        tooltip.style.left = menuRect.right + 8 + 'px'
        tooltip.style.right = ''
        Object.assign(caret.style, {
          left: '-10px',
          right: '',
          borderRightColor: '#000',
          borderLeftColor: 'transparent',
        })
      } else {
        tooltip.style.left = ''
        tooltip.style.right = innerWidth - menuRect.left + 8 + 'px'
        Object.assign(caret.style, {
          left: '',
          right: '-10px',
          borderLeftColor: '#000',
          borderRightColor: 'transparent',
        })
      }
      tooltip.style.opacity = '1'
    }, 400)
  })

  menu.addEventListener('mouseout', (e) => {
    const btn = (e.target as Element).closest('button[data-tooltip]')
    if (!btn?.contains(e.relatedTarget as Node)) {
      if (tooltipTimer) clearTimeout(tooltipTimer)
      tooltip.style.opacity = '0'
    }
  })

  menu.addEventListener('mousedown', () => {
    if (tooltipTimer) clearTimeout(tooltipTimer)
    tooltip.style.opacity = '0'
  })

  function closeAll(): void {
    typography.close()
    settings.close()
    theme.close()
    exporter.close()
  }

  return { typography, settings, theme, exporter, closeAll }
}
