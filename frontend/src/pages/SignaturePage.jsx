import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import SignatureCanvas from 'react-signature-canvas'
import BorderColorRoundedIcon from '@mui/icons-material/BorderColorRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import { useAuth } from '../context/AuthContext'
import { getMySignature, saveMySignature } from '../api/overtime'
import { FilterStrip, PageShell, SectionCard } from '../components/ui/PageScaffold'

export default function SignaturePage() {
  const ref = useRef(null)
  const { user } = useAuth()

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const canUseSignature = ['supervisor', 'manager', 'admin'].includes(user?.role)

  useEffect(() => {
    if (!canUseSignature) return

    setLoading(true)
    setError('')
    getMySignature()
      .then(({ data }) => {
        if (data?.dataUrl && ref.current) {
          ref.current.fromDataURL(data.dataUrl)
        }
      })
      .catch((err) => {
        setError(err?.response?.data?.error || err?.message || 'Failed to load saved signature')
      })
      .finally(() => setLoading(false))
  }, [canUseSignature])

  async function save() {
    if (!ref.current || ref.current.isEmpty()) {
      setError('Add a signature before saving')
      return
    }

    setSaving(true)
    setNotice('')
    setError('')
    try {
      const dataUrl = ref.current.getTrimmedCanvas().toDataURL('image/png')
      await saveMySignature({ dataUrl })
      setNotice('Signature saved successfully')
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to save signature')
    } finally {
      setSaving(false)
    }
  }

  function clear() {
    ref.current?.clear()
  }

  return (
    <PageShell
      eyebrow="Staffing and Scheduling"
      title="Signature"
      description="Store the signature used in overtime approvals and exports so the workflow stays self-service for supervisors and managers."
      accent="#0f766e"
      stats={[
        {
          label: 'Role',
          value: String(user?.role || 'unknown').toUpperCase(),
          helper: 'Loaded from your current login session',
          accent: '#0f766e'
        },
        {
          label: 'Status',
          value: loading ? 'Loading' : 'Ready',
          helper: 'Saved signature is pulled into the canvas when available',
          accent: '#2563eb'
        }
      ]}
    >
      {!canUseSignature ? (
        <Alert severity="warning">Only supervisor, manager, or admin users can save approval signatures.</Alert>
      ) : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {notice ? <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert> : null}

      <SectionCard
        title="Approval Signature"
        subtitle="Draw a clean signature below. If you already had one saved, it loads into the canvas when the page opens."
        accent="#0f766e"
      >
        <Stack spacing={1}>
          <FilterStrip>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Tip: use a wider stroke on a touchpad or pen device, then save once you are happy with the final shape.
            </Typography>
          </FilterStrip>

          <Box
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              overflow: 'hidden',
              width: '100%',
              maxWidth: 760,
              bgcolor: '#fff'
            }}
          >
            <SignatureCanvas
              ref={ref}
              penColor="black"
              canvasProps={{ width: 720, height: 240, style: { width: '100%', height: 240 } }}
            />
          </Box>

          <Stack direction="row" spacing={0.8} flexWrap="wrap">
            <Button variant="contained" startIcon={<SaveRoundedIcon />} onClick={save} disabled={!canUseSignature || saving}>
              Save Signature
            </Button>
            <Button variant="outlined" startIcon={<RestartAltRoundedIcon />} onClick={clear} disabled={!canUseSignature || saving}>
              Clear
            </Button>
            <Button variant="text" startIcon={<BorderColorRoundedIcon />} disabled>
              Stored against your current login
            </Button>
          </Stack>
        </Stack>
      </SectionCard>
    </PageShell>
  )
}
