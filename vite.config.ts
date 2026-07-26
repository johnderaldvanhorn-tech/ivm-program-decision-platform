import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

type GeocodeResult = {
  latitude: number
  longitude: number
  matchedAddress?: string
  provider: string
}

function geocodeApi(): Plugin {
  return {
    name: 'ivm-local-geocode-api',
    configureServer(server) {
      server.middlewares.use('/api/geocode', async (req: any, res: any) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')

        try {
          const requestUrl = new URL(req.url || '/', 'http://localhost')
          const address = requestUrl.searchParams.get('address')?.trim()
          if (!address) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'An address is required.' }))
            return
          }

          const result = await geocodeAddress(address)
          if (!result) {
            res.statusCode = 404
            res.end(JSON.stringify({ error: 'No coordinate match was found. Check the address, city, state, and ZIP.' }))
            return
          }

          res.statusCode = 200
          res.end(JSON.stringify(result))
        } catch (error) {
          console.error('Geocoding failed:', error)
          res.statusCode = 502
          res.end(JSON.stringify({
            error: 'The geocoding services could not be reached. Check your internet connection and try again.',
          }))
        }
      })
    },
  }
}

async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  // OpenStreetMap Nominatim is the primary provider because it supports full
  // street-address lookups and can be called safely from this local server.
  try {
    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.searchParams.set('q', address)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('limit', '1')
    url.searchParams.set('countrycodes', 'us')
    url.searchParams.set('addressdetails', '1')

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'IVM-Program-Decision-Platform/0.1 (local development)',
      },
      signal: AbortSignal.timeout(12000),
    })

    if (response.ok) {
      const rows = await response.json() as Array<{ lat?: string; lon?: string; display_name?: string }>
      const row = rows[0]
      const latitude = Number(row?.lat)
      const longitude = Number(row?.lon)
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return { latitude, longitude, matchedAddress: row.display_name, provider: 'OpenStreetMap' }
      }
    }
  } catch (error) {
    console.warn('OpenStreetMap geocoder unavailable:', error)
  }

  // Fall back to the U.S. Census geocoder.
  try {
    const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress')
    url.searchParams.set('address', address)
    url.searchParams.set('benchmark', 'Public_AR_Current')
    url.searchParams.set('format', 'json')

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    })

    if (response.ok) {
      const data = await response.json() as {
        result?: { addressMatches?: Array<{ coordinates?: { x?: number; y?: number }; matchedAddress?: string }> }
      }
      const match = data.result?.addressMatches?.[0]
      const latitude = Number(match?.coordinates?.y)
      const longitude = Number(match?.coordinates?.x)
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return { latitude, longitude, matchedAddress: match?.matchedAddress, provider: 'U.S. Census' }
      }
    }
  } catch (error) {
    console.warn('Census geocoder unavailable:', error)
  }

  return null
}

export default defineConfig({
  plugins: [react(), tailwindcss(), geocodeApi()],
})
