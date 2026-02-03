import React, { useRef } from "react"
import { Box, Button, Card, CardContent, Stack, Typography } from "@mui/material"
import SignatureCanvas from "react-signature-canvas"
import axios from "../utils/axios"

export default function SignaturePage() {
  const ref = useRef(null)

  async function save() {
    const dataUrl = ref.current.getTrimmedCanvas().toDataURL("image/png")

    // choose endpoint based on logged in user type
    // replace this with your actual auth user object
    const userType = window.__USER__?.type

    if (userType === "supervisor") {
      await axios.put("/api/signatures/supervisor/me", { imageDataUrl: dataUrl })
    } else if (userType === "manager") {
      await axios.put("/api/signatures/manager/me", { imageDataUrl: dataUrl })
    } else {
      alert("Only supervisors and managers can save signatures")
      return
    }

    alert("Saved")
  }

  function clear() {
    ref.current.clear()
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>Signature</Typography>

      <Card sx={{ maxWidth: 720 }}>
        <CardContent>
          <Box sx={{ border: "1px solid #ccc", borderRadius: 1, overflow: "hidden" }}>
            <SignatureCanvas
              ref={ref}
              penColor="black"
              canvasProps={{ width: 680, height: 220 }}
            />
          </Box>

          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <Button variant="contained" onClick={save}>Save</Button>
            <Button variant="outlined" onClick={clear}>Clear</Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  )
}
