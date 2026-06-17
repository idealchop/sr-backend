export interface TeamChatMessageAttachmentDto {
  url: string;
  fileName?: string;
  mimeType?: string;
}

export type TeamChatReactionType =
  | "heart"
  | "like"
  | "dislike"
  | "disgusting"
  | "awe"
  | "happy"
  | "sad";

export type TeamChatMessageReactionsDto = Partial<
  Record<TeamChatReactionType, string[]>
>;

export interface TeamChatMessageDto {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: string;
  attachments?: TeamChatMessageAttachmentDto[];
  reactions?: TeamChatMessageReactionsDto;
  deleted?: boolean;
}

export interface TeamChatConversationDto {
  id: string;
  peerUserId: string;
  title: string;
  initials: string;
  preview: string;
  lastMessageAt: string | null;
  peerRole: string;
  unreadCount: number;
}

export interface TeamChatDirectoryDto {
  conversations: TeamChatConversationDto[];
  totalUnreadCount: number;
  retentionDays: number;
}
