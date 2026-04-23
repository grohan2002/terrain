"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

// --------------------------------------------------------------------------
// Self-contained resizable panel system using CSS flexbox and mouse events.
// Usage:
//   <ResizablePanelGroup direction="horizontal">
//     <ResizablePanel defaultSize={50}>Left</ResizablePanel>
//     <ResizableHandle />
//     <ResizablePanel defaultSize={50}>Right</ResizablePanel>
//   </ResizablePanelGroup>
// --------------------------------------------------------------------------

interface PanelGroupContextValue {
  direction: "horizontal" | "vertical"
  sizes: number[]
  setSizes: React.Dispatch<React.SetStateAction<number[]>>
  registerPanel: (id: string, defaultSize: number, minSize: number, maxSize: number) => number
  startResize: (handleIndex: number) => void
}

const PanelGroupContext = React.createContext<PanelGroupContextValue | undefined>(undefined)

function usePanelGroupContext() {
  const context = React.useContext(PanelGroupContext)
  if (!context) {
    throw new Error("Resizable components must be used within a ResizablePanelGroup")
  }
  return context
}

interface ResizablePanelGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  direction?: "horizontal" | "vertical"
  onLayout?: (sizes: number[]) => void
}

const ResizablePanelGroup = React.forwardRef<HTMLDivElement, ResizablePanelGroupProps>(
  ({ className, direction = "horizontal", onLayout, children, ...props }, ref) => {
    const [sizes, setSizes] = React.useState<number[]>([])
    const panelCountRef = React.useRef(0)
    const panelConfigsRef = React.useRef<Array<{ minSize: number; maxSize: number }>>([])
    const containerRef = React.useRef<HTMLDivElement | null>(null)
    const resizingRef = React.useRef<{ handleIndex: number; startPos: number; startSizes: number[] } | null>(null)

    const registerPanel = React.useCallback(
      (id: string, defaultSize: number, minSize: number, maxSize: number) => {
        const index = panelCountRef.current++
        panelConfigsRef.current[index] = { minSize, maxSize }
        setSizes((prev) => {
          const next = [...prev]
          next[index] = defaultSize
          return next
        })
        return index
      },
      []
    )

    const startResize = React.useCallback((handleIndex: number) => {
      resizingRef.current = { handleIndex, startPos: 0, startSizes: [...sizes] }
    }, [sizes])

    React.useEffect(() => {
      if (!resizingRef.current) return

      const handleMouseMove = (e: MouseEvent) => {
        if (!resizingRef.current || !containerRef.current) return

        const rect = containerRef.current.getBoundingClientRect()
        const totalSize = direction === "horizontal" ? rect.width : rect.height
        const pos = direction === "horizontal" ? e.clientX - rect.left : e.clientY - rect.top
        const percentage = (pos / totalSize) * 100

        const { handleIndex, startSizes } = resizingRef.current
        const beforeIndex = handleIndex
        const afterIndex = handleIndex + 1

        if (beforeIndex >= startSizes.length || afterIndex >= startSizes.length) return

        // Sum of all panels before the resize pair
        let beforeSum = 0
        for (let i = 0; i < beforeIndex; i++) {
          beforeSum += sizes[i] || 0
        }

        // Sum of all panels after the resize pair
        let afterSum = 0
        for (let i = afterIndex + 1; i < sizes.length; i++) {
          afterSum += sizes[i] || 0
        }

        const available = 100 - beforeSum - afterSum
        let newBeforeSize = percentage - beforeSum
        let newAfterSize = available - newBeforeSize

        const beforeConfig = panelConfigsRef.current[beforeIndex] || { minSize: 0, maxSize: 100 }
        const afterConfig = panelConfigsRef.current[afterIndex] || { minSize: 0, maxSize: 100 }

        // Clamp sizes
        newBeforeSize = Math.max(beforeConfig.minSize, Math.min(beforeConfig.maxSize, newBeforeSize))
        newAfterSize = available - newBeforeSize
        newAfterSize = Math.max(afterConfig.minSize, Math.min(afterConfig.maxSize, newAfterSize))
        newBeforeSize = available - newAfterSize

        setSizes((prev) => {
          const next = [...prev]
          next[beforeIndex] = newBeforeSize
          next[afterIndex] = newAfterSize
          return next
        })
      }

      const handleMouseUp = () => {
        resizingRef.current = null
        document.body.style.cursor = ""
        document.body.style.userSelect = ""
      }

      document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize"
      document.body.style.userSelect = "none"

      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)

      return () => {
        document.removeEventListener("mousemove", handleMouseMove)
        document.removeEventListener("mouseup", handleMouseUp)
      }
    })

    React.useEffect(() => {
      if (onLayout && sizes.length > 0) {
        onLayout(sizes)
      }
    }, [sizes, onLayout])

    const setRefs = React.useCallback(
      (node: HTMLDivElement | null) => {
        containerRef.current = node
        if (typeof ref === "function") ref(node)
        else if (ref) ref.current = node
      },
      [ref]
    )

    return (
      <PanelGroupContext.Provider value={{ direction, sizes, setSizes, registerPanel, startResize }}>
        <div
          ref={setRefs}
          data-panel-group=""
          data-panel-group-direction={direction}
          className={cn(
            "flex h-full w-full",
            direction === "horizontal" ? "flex-row" : "flex-col",
            className
          )}
          {...props}
        >
          {children}
        </div>
      </PanelGroupContext.Provider>
    )
  }
)
ResizablePanelGroup.displayName = "ResizablePanelGroup"

interface ResizablePanelProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultSize?: number
  minSize?: number
  maxSize?: number
  collapsible?: boolean
}

const ResizablePanel = React.forwardRef<HTMLDivElement, ResizablePanelProps>(
  ({ className, defaultSize = 50, minSize = 0, maxSize = 100, children, ...props }, ref) => {
    const { direction, sizes, registerPanel } = usePanelGroupContext()
    const indexRef = React.useRef<number>(-1)

    React.useEffect(() => {
      if (indexRef.current === -1) {
        indexRef.current = registerPanel(String(Math.random()), defaultSize, minSize, maxSize)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // eslint-disable-next-line react-hooks/refs -- indexRef is registered in a useEffect and read during render to derive a stable panel size; this is a valid pattern for this resizable panel primitive
    const size = indexRef.current >= 0 ? sizes[indexRef.current] : defaultSize
    const flexStyle =
      direction === "horizontal"
        ? { flexBasis: `${size}%`, flexGrow: 0, flexShrink: 0 }
        : { flexBasis: `${size}%`, flexGrow: 0, flexShrink: 0 }

    return (
      <div
        ref={ref}
        data-panel=""
        data-panel-size={size?.toFixed(1)}
        className={cn("overflow-hidden", className)}
        style={flexStyle}
        {...props}
      >
        {children}
      </div>
    )
  }
)
ResizablePanel.displayName = "ResizablePanel"

interface ResizableHandleProps extends React.HTMLAttributes<HTMLDivElement> {
  withHandle?: boolean
}

let handleCounter = 0

const ResizableHandle = React.forwardRef<HTMLDivElement, ResizableHandleProps>(
  ({ className, withHandle, ...props }, ref) => {
    const { direction, startResize } = usePanelGroupContext()
    const [handleIndex] = React.useState(() => handleCounter++)

    const handleMouseDown = React.useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault()
        startResize(handleIndex)
      },
      [handleIndex, startResize]
    )

    return (
      <div
        ref={ref}
        data-panel-resize-handle=""
        data-panel-group-direction={direction}
        className={cn(
          "relative flex items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1",
          direction === "horizontal"
            ? "w-px cursor-col-resize hover:bg-primary/20"
            : "h-px cursor-row-resize hover:bg-primary/20",
          className
        )}
        onMouseDown={handleMouseDown}
        {...props}
      >
        {withHandle && (
          <div
            className={cn(
              "z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border",
              direction === "vertical" && "h-3 w-4 rotate-90"
            )}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-muted-foreground"
            >
              <circle cx="9" cy="12" r="1" />
              <circle cx="15" cy="12" r="1" />
            </svg>
          </div>
        )}
      </div>
    )
  }
)
ResizableHandle.displayName = "ResizableHandle"

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
