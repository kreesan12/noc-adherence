let loaderPromise = null

export function loadGoogleMaps({ apiKey, libraries = ['places'] } = {}) {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'))
  if (window.google?.maps) return Promise.resolve(window.google.maps)

  const resolvedKey = apiKey || import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY
  if (!resolvedKey) return Promise.reject(new Error('Missing Google Maps API key'))

  if (!loaderPromise) {
    loaderPromise = new Promise((resolve, reject) => {
      const existing = document.getElementById('google-maps-script')
      if (existing) {
        existing.addEventListener('load', () => resolve(window.google.maps))
        existing.addEventListener('error', reject)
        return
      }

      const script = document.createElement('script')
      script.id = 'google-maps-script'
      script.async = true
      script.defer = true
      script.src = `https://maps.googleapis.com/maps/api/js?key=${resolvedKey}&libraries=${libraries.join(',')}`
      script.onload = () => resolve(window.google.maps)
      script.onerror = () => reject(new Error('Failed to load Google Maps script'))
      document.head.appendChild(script)
    })
  }

  return loaderPromise
}
