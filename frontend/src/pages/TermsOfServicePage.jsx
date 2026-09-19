import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Link, List, ListItem, Stack, Typography } from '@mui/material';
import PublicLegalLayout, { useDocumentMeta } from '../components/PublicLegalLayout';

const EFFECTIVE_DATE = 'September 20, 2026';
const LAST_UPDATED = 'September 20, 2026';
const CONTACT_EMAIL = 'firstofoshan@gmail.com';
const LEGAL_ENTITY = 'First Of Education International (PVT) Ltd.';
const SERVICE_NAME = 'First Of Solutions CRM';

const SECTIONS = [
  { id: 'introduction', title: 'A. Introduction' },
  { id: 'acceptance-of-terms', title: 'B. Acceptance of Terms' },
  { id: 'description-of-service', title: 'C. Description of Service' },
  { id: 'user-accounts', title: 'D. User Accounts and Authorized Access' },
  { id: 'facebook-meta-integration', title: 'E. Facebook / Meta Integration' },
  { id: 'whatsapp-integration', title: 'F. WhatsApp Integration' },
  { id: 'acceptable-use', title: 'G. Acceptable Use' },
  { id: 'user-responsibilities', title: 'H. User Responsibilities' },
  { id: 'data-and-privacy', title: 'I. Data and Privacy' },
  { id: 'third-party-services', title: 'J. Third-Party Services' },
  { id: 'intellectual-property', title: 'K. Intellectual Property' },
  { id: 'service-availability', title: 'L. Service Availability and Changes' },
  { id: 'limitation-of-liability', title: 'M. Limitation of Liability' },
  { id: 'suspension-or-termination', title: 'N. Suspension or Termination' },
  { id: 'changes-to-these-terms', title: 'O. Changes to These Terms' },
  { id: 'governing-law', title: 'P. Governing Law' },
  { id: 'contact-information', title: 'Q. Contact Information' }
];

function Section({ id, title, children }) {
  return (
    <Box id={id} component="section" sx={{ mb: 4, scrollMarginTop: '96px' }}>
      <Typography variant="h6" fontWeight={800} gutterBottom>{title}</Typography>
      <Stack spacing={1.5}>{children}</Stack>
    </Box>
  );
}

export default function TermsOfServicePage() {
  useDocumentMeta(
    'Terms of Service – First Of Solutions CRM',
    `Terms of Service for ${SERVICE_NAME}, operated by ${LEGAL_ENTITY}, including terms covering Facebook/Meta and WhatsApp integrations.`
  );

  return (
    <PublicLegalLayout
      title="Terms of Service"
      subtitle={`Effective Date: ${EFFECTIVE_DATE} · Last Updated: ${LAST_UPDATED}`}
    >
      <Typography paragraph>
        These Terms of Service ("Terms") govern access to and use of {SERVICE_NAME} (the "Service"), operated by{' '}
        {LEGAL_ENTITY} ("{LEGAL_ENTITY}", "we", "us", or "our"). By accessing or using the Service you agree to be
        bound by these Terms. If you do not agree to these Terms, do not access or use the Service.
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
          {LEGAL_ENTITY} operates {SERVICE_NAME}, a customer relationship management platform that helps businesses
          manage customer communication across channels including WhatsApp and connected Facebook Pages. These Terms
          apply to all individuals who access or use the Service, including business administrators, authorized
          staff/agents, and other authorized users.
        </Typography>
      </Section>

      <Section id="acceptance-of-terms" title="B. Acceptance of Terms">
        <Typography paragraph>
          By creating an account, logging in, or otherwise accessing or using the Service, you confirm that you have
          read, understood, and agree to be bound by these Terms and by our{' '}
          <Link component={RouterLink} to="/privacy-policy">Privacy Policy</Link>, which is incorporated into these
          Terms by reference. If you are accessing the Service on behalf of a business or other organization, you
          represent that you are authorized to accept these Terms on that organization's behalf.
        </Typography>
      </Section>

      <Section id="description-of-service" title="C. Description of Service">
        <Typography paragraph>
          {SERVICE_NAME} provides tools for managing customer conversations, leads, contacts, and related business
          workflows, including features that connect to messaging channels such as WhatsApp and Facebook Messenger,
          and that allow authorized staff to view and respond to Facebook Page comments. The specific features
          available to a given account may vary depending on configuration, subscription, and the integrations that
          account has connected.
        </Typography>
      </Section>

      <Section id="user-accounts" title="D. User Accounts and Authorized Access">
        <Typography paragraph>
          Access to the Service is provided through user accounts issued or approved by an authorized administrator
          of the business using the Service. You are responsible for maintaining the confidentiality of your login
          credentials and for all activity that occurs under your account. You agree to notify us or your
          administrator promptly of any unauthorized use of your account. We are not liable for any loss arising
          from unauthorized access resulting from your failure to safeguard your credentials.
        </Typography>
      </Section>

      <Section id="facebook-meta-integration" title="E. Facebook / Meta Integration">
        <Typography paragraph>
          The Service offers optional integrations with Meta Platforms, Inc. ("Meta") products, including Facebook
          Pages, Facebook Messenger, and Facebook Page comments. This functionality operates only in relation to
          Facebook Pages and accounts that have been explicitly connected and authorized by the relevant business
          administrator or user, using credentials and permissions that administrator or user controls. We do not
          access, read, or act on any Facebook Page or account that has not been explicitly connected to the
          Service.
        </Typography>
        <Typography paragraph>
          Use of Meta's platforms and APIs through the Service is also subject to Meta's own terms and policies.{' '}
          {SERVICE_NAME} is an independent product operated by {LEGAL_ENTITY}. It is not affiliated with, endorsed
          by, or sponsored by Meta Platforms, Inc., Facebook, or WhatsApp. "Facebook," "Messenger," "WhatsApp," and
          "Meta" are trademarks of their respective owners.
        </Typography>
      </Section>

      <Section id="whatsapp-integration" title="F. WhatsApp Integration">
        <Typography paragraph>
          The Service offers optional integration with WhatsApp for sending and receiving customer messages through
          numbers and accounts that a business has explicitly connected. Use of WhatsApp through the Service is
          subject to the applicable WhatsApp Business terms and policies, in addition to these Terms. You are
          responsible for ensuring that messages sent through a connected WhatsApp account comply with those
          policies and with applicable law, including rules on consent and unsolicited messaging.
        </Typography>
      </Section>

      <Section id="acceptable-use" title="G. Acceptable Use">
        <Typography paragraph>When using the Service, you agree that you will not:</Typography>
        <List dense sx={{ listStyleType: 'disc', pl: 3, '& .MuiListItem-root': { display: 'list-item', px: 0 } }}>
          <ListItem disablePadding>Use the Service for any unlawful purpose or in violation of any applicable law or regulation.</ListItem>
          <ListItem disablePadding>Access, connect, or attempt to connect a Facebook Page, WhatsApp account, or other third-party account that you are not authorized to manage.</ListItem>
          <ListItem disablePadding>Send unsolicited, abusive, deceptive, or spam messages through WhatsApp, Facebook Messenger, or any other channel connected to the Service.</ListItem>
          <ListItem disablePadding>Attempt to interfere with, disrupt, reverse engineer, or gain unauthorized access to the Service or its underlying systems.</ListItem>
          <ListItem disablePadding>Use the Service to store or transmit content that infringes the rights of others or violates Meta's or WhatsApp's platform policies.</ListItem>
          <ListItem disablePadding>Share your account credentials with, or grant access to, anyone not authorized by your organization.</ListItem>
        </List>
      </Section>

      <Section id="user-responsibilities" title="H. User Responsibilities">
        <Typography paragraph>
          You are responsible for the accuracy of information you enter into the Service, for the conduct of staff
          you authorize to use your account, and for ensuring that any Facebook Page or WhatsApp account you connect
          is one you are legally authorized to manage. You are responsible for obtaining any consents required from
          your own customers before communicating with them through channels connected to the Service.
        </Typography>
      </Section>

      <Section id="data-and-privacy" title="I. Data and Privacy">
        <Typography paragraph>
          Our collection, use, and protection of information in connection with the Service, including information
          received through connected Facebook Pages and WhatsApp accounts, is described in our{' '}
          <Link component={RouterLink} to="/privacy-policy">Privacy Policy</Link>. By using the Service, you agree to
          the collection and use of information as described there. If you have interacted with a Facebook Page
          connected to the Service and wish to request deletion of associated information, see our{' '}
          <Link component={RouterLink} to="/facebook-data-deletion">Facebook Data Deletion Instructions</Link> page.
        </Typography>
      </Section>

      <Section id="third-party-services" title="J. Third-Party Services">
        <Typography paragraph>
          The Service integrates with third-party platforms, including Meta (Facebook Messenger and Facebook Page
          comments) and WhatsApp, as well as hosting and infrastructure providers that help operate the Service.
          These third-party services are governed by their own terms and privacy policies, which are outside our
          control. We are not responsible for the availability, content, or practices of any third-party service,
          and your use of any such service is at your own risk and subject to that provider's own terms.
        </Typography>
      </Section>

      <Section id="intellectual-property" title="K. Intellectual Property">
        <Typography paragraph>
          The Service, including its software, design, and content (excluding customer data and third-party
          trademarks), is owned by {LEGAL_ENTITY} and is protected by applicable intellectual property laws. Except
          for the limited right to access and use the Service as permitted by these Terms, no rights, title, or
          interest in the Service are transferred to you. You retain ownership of the data and content you submit
          to the Service.
        </Typography>
      </Section>

      <Section id="service-availability" title="L. Service Availability and Changes">
        <Typography paragraph>
          We aim to keep the Service available and reliable, but we do not guarantee uninterrupted or error-free
          operation. The Service may be temporarily unavailable due to maintenance, updates, or factors outside our
          control, including outages or changes on the part of third-party platforms such as Meta or WhatsApp. We
          may add, modify, or remove features of the Service from time to time.
        </Typography>
      </Section>

      <Section id="limitation-of-liability" title="M. Limitation of Liability">
        <Typography paragraph>
          To the fullest extent permitted by applicable law, {LEGAL_ENTITY} shall not be liable for any indirect,
          incidental, special, consequential, or punitive damages, or any loss of profits, revenue, data, or
          business opportunity, arising out of or in connection with your use of, or inability to use, the Service,
          including any interruption, error, or unavailability of third-party platforms such as Meta or WhatsApp.
          Our total liability arising out of or relating to these Terms or the Service shall not exceed the amount,
          if any, paid by you for the Service in the twelve (12) months preceding the event giving rise to the
          claim.
        </Typography>
      </Section>

      <Section id="suspension-or-termination" title="N. Suspension or Termination">
        <Typography paragraph>
          We may suspend or terminate your access to the Service, in whole or in part, if we reasonably believe you
          have violated these Terms, misused a connected Facebook Page or WhatsApp account, or created risk or legal
          exposure for the Service, its other users, or {LEGAL_ENTITY}. You may stop using the Service, and an
          authorized administrator may disconnect any connected Facebook Page or WhatsApp account, at any time.
          Provisions of these Terms that by their nature should survive termination will continue to apply.
        </Typography>
      </Section>

      <Section id="changes-to-these-terms" title="O. Changes to These Terms">
        <Typography paragraph>
          We may update these Terms from time to time to reflect changes in the Service, our practices, or
          applicable requirements. When we do, we will revise the "Last Updated" date at the top of this page.
          Continued use of the Service after changes take effect constitutes acceptance of the revised Terms.
        </Typography>
      </Section>

      <Section id="governing-law" title="P. Governing Law">
        <Typography paragraph>
          These Terms are governed by, and construed in accordance with, the laws of Sri Lanka, without regard to
          conflict-of-law principles. Any dispute arising out of or relating to these Terms or the Service shall be
          subject to the exclusive jurisdiction of the courts of Sri Lanka.
        </Typography>
      </Section>

      <Section id="contact-information" title="Q. Contact Information">
        <Typography paragraph>If you have questions about these Terms, please contact:</Typography>
        <Typography fontWeight={700}>{LEGAL_ENTITY}</Typography>
        <Typography>
          Email: <Link href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</Link>
        </Typography>
      </Section>
    </PublicLegalLayout>
  );
}
