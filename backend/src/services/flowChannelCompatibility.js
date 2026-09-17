const CHANNELS = ['whatsapp', 'facebook_messenger', 'facebook_comment'];

// Node types that only make sense on WhatsApp: WhatsApp Flows is a WhatsApp
// Business Platform product with no Messenger equivalent; list_message and
// appointment_booking (built on list_message rendering) need WhatsApp's
// sections+rows list UI, which Messenger has no equivalent of; Messenger has
// no outbound "send a location" message type for businesses.
const WHATSAPP_ONLY_NODE_TYPES = new Set(['whatsapp_flow', 'list_message', 'appointment_booking', 'location']);

// facebook_comment_reply posts a public reply to a Facebook Page comment —
// it is meaningless outside a flow that is enabled for facebook_comment.
const COMMENT_ONLY_NODE_TYPES = new Set(['facebook_comment_reply']);

// Returns the effective channel list for a flow: the new `channels` array
// when set, otherwise the legacy single `channel` column (defaulting to
// 'whatsapp'), which is exactly today's pre-multi-channel behavior.
function flowChannels(flow) {
  if (Array.isArray(flow?.channels) && flow.channels.length) return flow.channels;
  return [flow?.channel || 'whatsapp'];
}

function isNodeSupportedOnChannel(nodeType, channel) {
  if (COMMENT_ONLY_NODE_TYPES.has(nodeType)) return channel === 'facebook_comment';
  if (channel === 'whatsapp') return true;
  if (channel === 'facebook_messenger' || channel === 'facebook_comment') return !WHATSAPP_ONLY_NODE_TYPES.has(nodeType);
  return true;
}

// A node is fully supported for a flow only if it works on every channel
// that flow is enabled for — a node that only half-works is a design-time
// warning (see nodeCompatibilityIssues), not a silent partial success.
function isNodeSupportedOnChannels(nodeType, channels) {
  return channels.every((channel) => isNodeSupportedOnChannel(nodeType, channel));
}

function unsupportedChannelsForNode(nodeType, channels) {
  return channels.filter((channel) => !isNodeSupportedOnChannel(nodeType, channel));
}

// Design-time warnings for the Flow Builder: one entry per node whose type
// doesn't work on at least one of the flow's selected channels.
function nodeCompatibilityIssues(flow) {
  const channels = flowChannels(flow);
  const issues = [];
  for (const node of flow.nodes || []) {
    const unsupported = unsupportedChannelsForNode(node.nodeType, channels);
    if (unsupported.length) {
      issues.push({
        nodeKey: node.nodeKey,
        severity: 'warning',
        code: 'FLOW_NODE_CHANNEL_UNSUPPORTED',
        message: `"${node.label || node.nodeType}" is not supported on ${unsupported.join(', ')} and will fail if reached by a run on that channel.`
      });
    }
  }
  return issues;
}

module.exports = {
  CHANNELS,
  WHATSAPP_ONLY_NODE_TYPES,
  COMMENT_ONLY_NODE_TYPES,
  flowChannels,
  isNodeSupportedOnChannel,
  isNodeSupportedOnChannels,
  unsupportedChannelsForNode,
  nodeCompatibilityIssues
};
