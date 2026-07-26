import { useEffect } from 'react'
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet'
import { Link } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export type MapLocation = {
  id?: string
  machine_id: string
  agency: string
  location_name: string
  address: string | null
  city: string | null
  state: string | null
  latitude: number | null
  longitude: number | null
  location_demographics?: any
  location_access_scores?: any
}

function first<T>(value: T[] | T | null | undefined): T | null { return Array.isArray(value) ? value[0] ?? null : value ?? null }
function score(row: MapLocation, field: 'accessibility'|'risk'|'maximum') {
  const raw = field === 'accessibility' ? first<any>(row.location_access_scores)?.machine_accessibility_score : field === 'risk' ? first<any>(row.location_demographics)?.risk_score : first<any>(row.location_demographics)?.maximum_location_score
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : null
}
function markerColor(value: number | null, field: 'accessibility'|'risk'|'maximum') {
  if (value == null) return '#64748b'
  if (field === 'risk') return value <= .30 ? '#10b981' : value <= .60 ? '#f59e0b' : '#ef4444'
  return value >= .67 ? '#10b981' : value >= .34 ? '#f59e0b' : '#ef4444'
}
function FitBounds({ rows }: { rows: MapLocation[] }) {
  const map = useMap()
  useEffect(() => {
    const points = rows.filter(r => r.latitude != null && r.longitude != null).map(r => [Number(r.latitude), Number(r.longitude)] as [number, number])
    if (points.length === 1) map.setView(points[0], 12)
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [30, 30] })
  }, [map, rows])
  return null
}
export default function LocationMap({ rows, metric }: { rows: MapLocation[]; metric: 'accessibility'|'risk'|'maximum' }) {
  const mapped = rows.filter(r => r.latitude != null && r.longitude != null)
  if (!mapped.length) return <div className="flex h-[520px] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">No locations currently have latitude and longitude.</div>
  return <div className="overflow-hidden rounded-2xl border border-slate-200">
    <MapContainer center={[39.5,-77]} zoom={7} className="h-[620px] w-full" scrollWheelZoom>
      <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <FitBounds rows={mapped}/>
      {mapped.map(row => {
        const value = score(row, metric)
        const color = markerColor(value, metric)
        return <CircleMarker key={row.machine_id} center={[Number(row.latitude), Number(row.longitude)]} radius={12} pathOptions={{ color, fillColor: color, fillOpacity: .85, weight: 3 }}>
          <Popup><div className="min-w-[220px]"><strong>{row.machine_id}</strong><div>{row.agency}</div><div>{row.location_name}</div><div>{[row.address,row.city,row.state].filter(Boolean).join(', ')}</div><div style={{marginTop:8,fontWeight:700}}>{metric === 'risk' ? 'Risk' : metric === 'maximum' ? 'Maximum Location' : 'Accessibility'}: {value == null ? 'Not scored' : `${Math.round(value*100)}%`}</div>{row.id && <Link to={`/locations/${row.id}`}>Open location</Link>}</div></Popup>
        </CircleMarker>
      })}
    </MapContainer>
  </div>
}
