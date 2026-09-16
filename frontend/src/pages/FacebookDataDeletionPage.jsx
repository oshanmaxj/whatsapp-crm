import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Link, List, ListItem, Stack, Typography } from '@mui/material';
import PublicLegalLayout, { useDocumentMeta } from '../components/PublicLegalLayout';

const LAST_UPDATED = 'September 17, 2026';
const CONTACT_EMAIL = 'firstofsolutions@gmail.com';

export default function FacebookDataDeletionPage() {
  useDocumentMeta(
    'Facebook Data Deletion | First Of Solutions',
    'Instructions for requesting deletion of information associated with your Facebook or Messenger interaction with First Of Solutions CRM.'
  );

  return (
    <PublicLegalLayout title="Facebook Data Deletion Instructions" subtitle={`Last Updated: ${LAST_UPDATED}`}>
      <Stack spacing={2.5}>
        <Typography paragraph>
          If you have contacted a Facebook Page connected to First Of Solutions CRM through Messenger, or commented
          on a post from such a Page, you may request that we delete the information associated with that
          interaction from our systems.
        </Typography>

        <Typography variant="h6" fontWeight={800}>How to request deletion</Typography>
        <Typography paragraph>
          Send an email to <Link href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</Link> with a subject line such as
          "Facebook Data Deletion Request". To help us locate and verify the correct interaction, please include as
          much of the following as you can:
        </Typography>
        <List dense sx={{ listStyleType: 'disc', pl: 3, '& .MuiListItem-root': { display: 'list-item', px: 0 } }}>
          <ListItem disablePadding>The name of the Facebook Page you contacted or commented on.</ListItem>
          <ListItem disablePadding>The approximate date of the conversation or comment.</ListItem>
          <ListItem disablePadding>The name or account identifier you used on Facebook or Messenger.</ListItem>
          <ListItem disablePadding>Any other detail that helps us identify the specific interaction (for example a summary of what was discussed).</ListItem>
        </List>

        <Alert severity="warning" variant="outlined">
          Never send us your Facebook password, access token, App Secret, or any other authentication credential.
          We will never ask for these, and we do not need them to process a deletion request.
        </Alert>

        <Typography variant="h6" fontWeight={800}>What happens next</Typography>
        <Typography paragraph>
          We will review your request and delete the associated personal information from our systems, subject to
          any legal, security, or record-retention obligations that may require us to retain certain records for a
          period of time. We will confirm with you once your request has been processed.
        </Typography>

        <Typography paragraph>
          For more information about how we collect, use, and protect information in general, see our{' '}
          <Link component={RouterLink} to="/privacy-policy">Privacy Policy</Link>.
        </Typography>
      </Stack>
    </PublicLegalLayout>
  );
}
