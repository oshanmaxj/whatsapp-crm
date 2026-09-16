import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Link, List, ListItem, ListItemText, Stack, Typography } from '@mui/material';
import PublicLegalLayout, { useDocumentMeta } from '../components/PublicLegalLayout';

const LAST_UPDATED = 'September 17, 2026';
const CONTACT_EMAIL = 'firstofsolutions@gmail.com';

const SECTIONS = [
  { id: 'introduction', title: 'A. Introduction' },
  { id: 'information-we-collect', title: 'B. Information We Collect' },
  { id: 'meta-platform-data', title: 'C. Meta Platform Data' },
  { id: 'how-information-is-used', title: 'D. How Information Is Used' },
  { id: 'facebook-messenger', title: 'E. Facebook Messenger' },
  { id: 'facebook-page-comments', title: 'F. Facebook Page Comments' },
  { id: 'data-sharing', title: 'G. Data Sharing' },
  { id: 'service-providers', title: 'H. Service Providers / Infrastructure' },
  { id: 'data-security', title: 'I. Data Security' },
  { id: 'data-retention', title: 'J. Data Retention' },
  { id: 'data-deletion', title: 'K. Data Deletion / User Requests' },
  { id: 'facebook-meta-relationship', title: 'L. Facebook / Meta Relationship' },
  { id: 'childrens-privacy', title: "M. Children's Privacy" },
  { id: 'international-processing', title: 'N. International Processing' },
  { id: 'user-rights', title: 'O. User Rights' },
  { id: 'changes', title: 'P. Changes to This Policy' },
  { id: 'contact-us', title: 'Q. Contact Us' }
];

function Section({ id, title, children }) {
  return (
    <Box id={id} component="section" sx={{ mb: 4, scrollMarginTop: '96px' }}>
      <Typography variant="h6" fontWeight={800} gutterBottom>{title}</Typography>
      <Stack spacing={1.5}>{children}</Stack>
    </Box>
  );
}

export default function PrivacyPolicyPage() {
  useDocumentMeta(
    'Privacy Policy | First Of Solutions',
    'Privacy Policy for First Of Solutions CRM, including information about Facebook Page, Messenger and customer communication data processing.'
  );

  return (
    <PublicLegalLayout title="Privacy Policy" subtitle={`Last Updated: ${LAST_UPDATED}`}>
      <Typography paragraph>
        This Privacy Policy explains how First Of Solutions ("First Of Solutions", "we", "us", or "our") collects,
        uses, stores, and protects information in connection with First Of Solutions CRM (the "Service"), including
        the features that connect to Facebook Pages, Facebook Messenger, and Facebook Page comments through Meta
        Platform APIs.
      </Typography>

      <Box sx={{ mb: 4, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
        <Typography variant="subtitle2" fontWeight={800} gutterBottom>Table of Contents</Typography>
        <List dense disablePadding sx={{ columns: { sm: 2 }, columnGap: 4 }}>
          {SECTIONS.map((section) => (
            <ListItem key={section.id} disablePadding sx={{ breakInside: 'avoid', py: 0.25 }}>
              <Link href={`#${section.id}`} underline="hover" variant="body2">{section.title}</Link>
            </ListItem>
          ))}
        </List>
      </Box>

      <Section id="introduction" title="A. Introduction">
        <Typography paragraph>
          First Of Solutions operates First Of Solutions CRM, a customer relationship management platform used to
          manage customer communication across channels including WhatsApp and connected Facebook Pages. This
          policy explains what information the Service collects, how it is used, how it is stored, and how it is
          protected. It applies to visitors of this page, to businesses using the Service, and to individuals who
          interact with a Facebook Page connected to the Service.
        </Typography>
      </Section>

      <Section id="information-we-collect" title="B. Information We Collect">
        <Typography paragraph>Depending on how the Service is used, we may collect the following categories of information:</Typography>
        <List dense sx={{ listStyleType: 'disc', pl: 3, '& .MuiListItem-root': { display: 'list-item', px: 0 } }}>
          <ListItem disablePadding>Facebook Page identifiers and basic Page information for Pages connected to the CRM.</ListItem>
          <ListItem disablePadding>Facebook Messenger sender/user identifiers made available to us through Meta when a person messages a connected Page.</ListItem>
          <ListItem disablePadding>Messages sent to, and replies sent from, connected Facebook Pages.</ListItem>
          <ListItem disablePadding>Page comments and replies received through Meta on connected Facebook Pages.</ListItem>
          <ListItem disablePadding>Message timestamps and related conversation metadata (for example conversation status and assignment).</ListItem>
          <ListItem disablePadding>Information voluntarily supplied by a user during a conversation (for example their name, enquiry details, or contact preferences).</ListItem>
          <ListItem disablePadding>CRM contact and lead records created from customer interactions (for example WhatsApp or Facebook conversations).</ListItem>
          <ListItem disablePadding>Operational and security logs generated by the Service where applicable (for example login activity and error diagnostics).</ListItem>
        </List>
        <Typography paragraph sx={{ fontWeight: 700 }}>
          We do not request or store Facebook account passwords. We never ask a Facebook or Messenger user for
          their password, and no such information is collected by the Service.
        </Typography>
      </Section>

      <Section id="meta-platform-data" title="C. Meta Platform Data">
        <Typography paragraph>
          When a business connects a Facebook Page to First Of Solutions CRM, certain information ("Meta Platform
          Data") is received through Meta Platform APIs and webhooks, such as Messenger messages and Page comments
          associated with that Page. Meta Platform Data is used only to provide legitimate CRM and customer
          communication functionality described in this policy, and its use is subject to the applicable Meta
          Platform Terms and policies in addition to this Privacy Policy.
        </Typography>
      </Section>

      <Section id="how-information-is-used" title="D. How Information Is Used">
        <Typography paragraph>Information collected through the Service is used to:</Typography>
        <List dense sx={{ listStyleType: 'disc', pl: 3, '& .MuiListItem-root': { display: 'list-item', px: 0 } }}>
          <ListItem disablePadding>Receive and display Messenger conversations from connected Facebook Pages.</ListItem>
          <ListItem disablePadding>Allow authorized agents to reply to customers through the CRM.</ListItem>
          <ListItem disablePadding>Receive and display Page comments so authorized staff can respond to them.</ListItem>
          <ListItem disablePadding>Manage customer enquiries and support requests.</ListItem>
          <ListItem disablePadding>Create and manage CRM contact and lead records arising from customer interactions.</ListItem>
          <ListItem disablePadding>Assign conversations and enquiries to authorized staff members.</ListItem>
          <ListItem disablePadding>Support workflow and automation features where such features are actually enabled for the account.</ListItem>
          <ListItem disablePadding>Maintain a history of conversations for continuity of customer service.</ListItem>
          <ListItem disablePadding>Operate, troubleshoot, and secure the Service.</ListItem>
        </List>
      </Section>

      <Section id="facebook-messenger" title="E. Facebook Messenger">
        <Typography paragraph>
          When a person sends a message to a Facebook Page connected to First Of Solutions CRM, Meta makes certain
          information about that message available to the Page through the Messenger Platform. The Service
          receives this information through Meta's webhooks, displays it to authorized agents of the connected
          business, and allows those agents to reply from within the CRM. This information is used solely to
          support the resulting customer conversation and related CRM record-keeping.
        </Typography>
      </Section>

      <Section id="facebook-page-comments" title="F. Facebook Page Comments">
        <Typography paragraph>
          Comments and replies posted on a connected Facebook Page's posts may be received by the Service through
          Meta's webhooks and displayed to authorized staff, allowing them to view, manage, and respond to customer
          engagement on the Page. The Service processes only the comment content and related public metadata made
          available by Meta for this purpose; it does not collect private profile information about commenters
          beyond what Meta provides for this functionality.
        </Typography>
      </Section>

      <Section id="data-sharing" title="G. Data Sharing">
        <Typography paragraph>Information may be shared only with the following categories of parties, and only where necessary to operate the Service:</Typography>
        <List dense sx={{ listStyleType: 'disc', pl: 3, '& .MuiListItem-root': { display: 'list-item', px: 0 } }}>
          <ListItem disablePadding>Meta Platforms, Inc., to the extent required to send and receive Messenger messages and Page comments through its APIs.</ListItem>
          <ListItem disablePadding>Hosting, infrastructure, and technical service providers who help operate the Service.</ListItem>
          <ListItem disablePadding>Authorized staff of the business using the CRM, for the purpose of customer communication and service.</ListItem>
          <ListItem disablePadding>Parties where disclosure is required to comply with applicable law, legal process, or to protect the rights, safety, or property of First Of Solutions or others.</ListItem>
        </List>
        <Typography paragraph sx={{ fontWeight: 700 }}>
          First Of Solutions does not sell personal information or Meta Platform Data, and does not share it with
          third parties for their own advertising or data-broker purposes.
        </Typography>
      </Section>

      <Section id="service-providers" title="H. Service Providers / Infrastructure">
        <Typography paragraph>
          The Service relies on third-party hosting, database, and infrastructure providers to operate. These
          providers process information solely to deliver hosting, storage, and related technical services on our
          behalf. For security reasons, we do not publish details of our internal infrastructure, server
          configuration, credentials, or access tokens.
        </Typography>
      </Section>

      <Section id="data-security" title="I. Data Security">
        <Typography paragraph>
          We use reasonable administrative and technical safeguards designed to protect information handled by the
          Service, including access controls that restrict CRM access to authorized staff and encrypted storage of
          sensitive configuration values such as connected-account credentials. However, no method of transmission
          over the internet or method of electronic storage is completely secure, and we cannot guarantee absolute
          security.
        </Typography>
      </Section>

      <Section id="data-retention" title="J. Data Retention">
        <Typography paragraph>
          We retain information only for as long as reasonably necessary to operate the Service, support ongoing
          customer relationships, and meet legitimate business, legal, or security obligations. Information may be
          deleted or anonymized when it is no longer needed for these purposes, subject to any legitimate retention
          requirements that may apply.
        </Typography>
      </Section>

      <Section id="data-deletion" title="K. Data Deletion / User Requests">
        <Typography paragraph>
          If you have interacted with a Facebook Page or Messenger account connected to First Of Solutions CRM and
          would like the associated personal information deleted, you may submit a request by contacting us at{' '}
          <Link href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</Link>.
        </Typography>
        <Typography paragraph>
          For full instructions, including what information to include with your request, see our{' '}
          <Link component={RouterLink} to="/facebook-data-deletion">Facebook Data Deletion Instructions</Link> page.
          We will review and process valid requests subject to applicable legal, security, and record-retention
          obligations.
        </Typography>
      </Section>

      <Section id="facebook-meta-relationship" title="L. Facebook / Meta Relationship">
        <Typography paragraph>
          First Of Solutions CRM is developed and operated independently by First Of Solutions. It is not owned,
          operated, or endorsed by Facebook or Meta Platforms, Inc. "Facebook" and "Meta" are trademarks of Meta
          Platforms, Inc. Use of the Messenger Platform and other Meta APIs is subject to Meta's own terms and
          policies.
        </Typography>
      </Section>

      <Section id="childrens-privacy" title="M. Children's Privacy">
        <Typography paragraph>
          The Service is intended for use by businesses and their customers in the ordinary course of business
          communication. It is not directed at children, and we do not intentionally collect personal information
          from children outside the context of a lawful customer interaction initiated by the account holder or
          their guardian.
        </Typography>
      </Section>

      <Section id="international-processing" title="N. International Processing">
        <Typography paragraph>
          Our hosting and infrastructure service providers may process and store information in locations other
          than the country where you or your customers are located. Where this occurs, we expect service providers
          to apply appropriate safeguards consistent with their own terms of service.
        </Typography>
      </Section>

      <Section id="user-rights" title="O. User Rights">
        <Typography paragraph>
          You may contact First Of Solutions to ask about access to, correction of, or deletion of personal
          information associated with you, or with any other questions about this Privacy Policy. We will respond
          to such requests subject to applicable law and any legitimate business or legal obligations that may
          apply.
        </Typography>
      </Section>

      <Section id="changes" title="P. Changes to This Policy">
        <Typography paragraph>
          We may update this Privacy Policy from time to time to reflect changes in the Service or applicable
          requirements. When we do, we will revise the "Last Updated" date at the top of this page.
        </Typography>
      </Section>

      <Section id="contact-us" title="Q. Contact Us">
        <Typography paragraph>If you have questions about this Privacy Policy or how your information is handled, please contact:</Typography>
        <Typography fontWeight={700}>First Of Solutions</Typography>
        <Typography>
          Email: <Link href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</Link>
        </Typography>
      </Section>
    </PublicLegalLayout>
  );
}
