import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Layers,
  Minimize2,
  Scissors,
  RotateCw,
  Maximize2,
  Crop,
  Settings2,
} from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type ToolTab =
  'merge' | 'compress' | 'extract' | 'rotate' | 'resize' | 'crop' | 'versionFix'

interface TabDef {
  id: ToolTab
  icon: ReactNode
  labelKey: string
}
interface NavTabsProps {
  activeTab: ToolTab
  onTabChange: (tab: ToolTab) => void
}

const tabs: TabDef[] = [
  { id: 'merge', icon: <Layers className="h-4 w-4" />, labelKey: 'nav.merge' },
  {
    id: 'compress',
    icon: <Minimize2 className="h-4 w-4" />,
    labelKey: 'nav.compress',
  },
  {
    id: 'extract',
    icon: <Scissors className="h-4 w-4" />,
    labelKey: 'nav.extract',
  },
  {
    id: 'rotate',
    icon: <RotateCw className="h-4 w-4" />,
    labelKey: 'nav.rotate',
  },
  {
    id: 'resize',
    icon: <Maximize2 className="h-4 w-4" />,
    labelKey: 'nav.resize',
  },
  { id: 'crop', icon: <Crop className="h-4 w-4" />, labelKey: 'nav.crop' },
  {
    id: 'versionFix',
    icon: <Settings2 className="h-4 w-4" />,
    labelKey: 'nav.versionFix',
  },
]

export function NavTabs({ activeTab, onTabChange }: NavTabsProps) {
  const { t } = useTranslation()
  return (
    <div className="border-b bg-background">
      <div className="mx-auto max-w-5xl px-4">
        <Tabs
          value={activeTab}
          onValueChange={(v) => onTabChange(v as ToolTab)}
        >
          <TabsList className="h-12 w-full justify-start overflow-x-auto rounded-none border-b-0 bg-transparent p-0">
            {tabs.map(({ id, icon, labelKey }) => (
              <TabsTrigger
                key={id}
                value={id}
                aria-label={t(labelKey)}
                className="flex h-12 items-center gap-2 rounded-none border-b-2 border-transparent px-4 py-0 text-sm font-medium data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                {icon}
                <span className="hidden sm:inline">{t(labelKey)}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
    </div>
  )
}
