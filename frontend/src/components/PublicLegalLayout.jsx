import React, { useEffect } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Container, Divider, Link, Paper, Stack, Typography } from '@mui/material';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';

// Sets document.title/description for these static public pages. No react-helmet
// dependency in this app, and these are the only pages that need per-route SEO tags.
export function useDocumentMeta(title, description) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    let meta = document.querySelector('meta[name="description"]');
    const createdMeta = !meta;
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    const previousDescription = meta.getAttribute('content');
    meta.setAttribute('content', description);

    return () => {
      document.title = previousTitle;
      if (createdMeta) {
        meta.remove();
      } else if (previousDescription !== null) {
        meta.setAttribute('content', previousDescription);
      }
    };
  }, [title, description]);
}

export default function PublicLegalLayout({ title, subtitle, children }) {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ bgcolor: '#071a15', color: '#fff', py: 3 }}>
        <Container maxWidth="md">
          <Stack direction="row" spacing={1.5} alignItems="center">
            <ShieldOutlinedIcon sx={{ color: '#25d366', fontSize: 32 }} />
            <Box>
              <Typography variant="h6" fontWeight={800} lineHeight={1.2}>First Of Solutions</Typography>
              <Typography variant="body2" sx={{ opacity: 0.75 }}>First Of Solutions CRM</Typography>
            </Box>
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="md" sx={{ flex: 1, py: { xs: 3, sm: 5 } }}>
        <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 5 } }}>
          <Typography variant="h4" fontWeight={800} gutterBottom>{title}</Typography>
          {subtitle && <Typography color="text.secondary" sx={{ mb: 3 }}>{subtitle}</Typography>}
          {children}
        </Paper>
      </Container>

      <Divider />
      <Box sx={{ py: 3 }}>
        <Container maxWidth="md">
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              &copy; {new Date().getFullYear()} First Of Solutions. All rights reserved.
            </Typography>
            <Stack direction="row" spacing={2}>
              <Link component={RouterLink} to="/privacy-policy" underline="hover" variant="body2">Privacy Policy</Link>
              <Link component={RouterLink} to="/facebook-data-deletion" underline="hover" variant="body2">Facebook Data Deletion</Link>
            </Stack>
          </Stack>
        </Container>
      </Box>
    </Box>
  );
}
