import React from 'react';
import { Box } from '@mui/material';

export function ChatLayout({
  conversationList,
  chat,
  workspace,
  showConversationList = true,
  showChat = true,
  showWorkspace = true
}) {
  return (
    <Box
      sx={{
        height: { xs: 'calc(100dvh - 104px)', md: 'calc(100vh - 120px)' },
        minHeight: { md: 620 },
        display: 'grid',
        gridTemplateColumns: {
          xs: 'minmax(0, 1fr)',
          lg: '320px minmax(420px, 1fr)',
          xl: showWorkspace ? '340px minmax(480px, 1fr) 360px' : '340px minmax(480px, 1fr)'
        },
        bgcolor: 'background.paper',
        border: (theme) => `1px solid ${theme.palette.divider}`,
        borderRadius: { xs: 0, sm: 2.5 },
        boxShadow: '0 18px 55px rgba(15, 23, 42, 0.08)',
        overflow: 'hidden'
      }}
    >
      <Box
        sx={{
          minWidth: 0,
          display: { xs: showConversationList ? 'flex' : 'none', lg: 'flex' },
          borderRight: (theme) => ({ lg: `1px solid ${theme.palette.divider}` }),
          overflow: 'hidden'
        }}
      >
        {conversationList}
      </Box>
      <Box
        sx={{
          minWidth: 0,
          display: { xs: showChat ? 'flex' : 'none', lg: 'flex' },
          overflow: 'hidden'
        }}
      >
        {chat}
      </Box>
      {showWorkspace && (
        <Box
          sx={{
            minWidth: 0,
            display: { xs: 'none', xl: 'flex' },
            borderLeft: (theme) => `1px solid ${theme.palette.divider}`,
            overflow: 'hidden'
          }}
        >
          {workspace}
        </Box>
      )}
    </Box>
  );
}

