import {
  Images,
  Layers,
  Minimize2,
  Scissors,
  RotateCw,
  Maximize2,
  Crop as CropIcon,
  Settings2,
} from 'lucide-react'
import { ImagesToPdf } from '@/components/tools/ImagesToPdf'
import { Merge } from '@/components/tools/Merge'
import { Compress } from '@/components/tools/Compress'
import { Extract } from '@/components/tools/Extract'
import { Rotate } from '@/components/tools/Rotate'
import { Resize } from '@/components/tools/Resize'
import { Crop } from '@/components/tools/Crop'
import { VersionFix } from '@/components/tools/VersionFix'
export const TOOLS = [
  { id: 'images', category: 'convert', icon: Images, component: ImagesToPdf },
  { id: 'merge', category: 'edit', icon: Layers, component: Merge },
  { id: 'compress', category: 'edit', icon: Minimize2, component: Compress },
  { id: 'extract', category: 'edit', icon: Scissors, component: Extract },
  { id: 'rotate', category: 'edit', icon: RotateCw, component: Rotate },
  { id: 'resize', category: 'edit', icon: Maximize2, component: Resize },
  { id: 'crop', category: 'edit', icon: CropIcon, component: Crop },
  {
    id: 'versionFix',
    category: 'utilities',
    icon: Settings2,
    component: VersionFix,
  },
] as const
export type ToolId = (typeof TOOLS)[number]['id']
export const TOOL_GROUPS = ['convert', 'edit', 'utilities'] as const
