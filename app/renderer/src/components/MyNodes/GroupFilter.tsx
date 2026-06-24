// GroupFilter — subscription filter chip bar (v2rayN lstGroup equivalent)
import { Tag } from 'antd'
import { AppstoreOutlined, StarOutlined } from '@ant-design/icons'

export interface GroupInfo { id: string; name: string; count: number }

interface Props {
  groups: GroupInfo[]
  selected: string       // '' = all
  onSelect: (id: string) => void
}

export default function GroupFilter({ groups, selected, onSelect }: Props): JSX.Element {
  const items: GroupInfo[] = [
    { id: '', name: '全部', count: groups.reduce((sum, g) => sum + g.count, 0) },
    ...groups,
  ]

  return (
    <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.map((g) => {
        const isManual = g.id === 'manual'
        const icon = g.id === '' ? <AppstoreOutlined />
          : isManual ? <StarOutlined />
          : null
        return (
          <Tag.CheckableTag
            key={g.id}
            checked={selected === g.id}
            onChange={() => onSelect(g.id)}
            style={{
              padding: '2px 12px', borderRadius: 16, cursor: 'pointer',
              fontSize: 13, lineHeight: '24px',
              border: selected === g.id ? undefined : '1px solid #d9d9d9',
            }}
          >
            {icon}{icon ? ' ' : ''}{g.name} ({g.count})
          </Tag.CheckableTag>
        )
      })}
    </div>
  )
}
