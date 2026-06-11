import React, { useState, useEffect } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Bell, Download, MessageSquare } from "lucide-react";
import * as LucideIcons from "lucide-react";
import { getUser } from "@/lib/supabase/user";
import { formatDistanceToNow } from "date-fns";

const DISCUSSION_NOTIFICATIONS = [
  {
    id: "discussion_seed_1",
    title: "New thread in Grounding",
    description: "Aadit opened a delivery risk discussion for this project.",
    type: "discussion",
    read: false,
    time: new Date().toISOString(),
    icon: "MessageSquare",
    bg_color: "bg-emerald-500/10",
    icon_color: "text-emerald-300",
    extra: {
      type: "discussion",
      channel: "Grounding",
      author: "Aadit Joshi",
      message: "We need a decision on the release checklist before the afternoon sync.",
      replies: 4,
      participants: ["AJ", "PM", "TL"],
    },
  },
];

export function NotificationsDropdown({ children }) {
  const [activeTab, setActiveTab] = useState("all");
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    const fetchNotifications = async () => {
      const userData = await getUser();

      if (userData) {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        const { data, error } = await supabase
          .from("flow_notifications")
          .select("*")
          .eq("user_id", userData.id)
          .order("time", { ascending: false });

        if (error) {
          console.error("[flow_notifications] fetch error:", error);
        }

        if (data) {
          setNotifications(data);
        }
      }
    };
    fetchNotifications();
  }, []);

  const visibleNotifications =
    notifications.length > 0 ? notifications : DISCUSSION_NOTIFICATIONS;

  const filteredNotifications = visibleNotifications.filter((n) => {
    if (activeTab === "all") return true;
    if (activeTab === "unread") return !n.read;
    if (activeTab === "discussions") return n.type === "discussion";
    if (activeTab === "mentions") return n.type === "mention";
    return true;
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {children || (
          <button className="w-8 h-8 rounded-full border border-transparent hover:bg-surface-hover flex items-center justify-center transition-colors text-muted-foreground hover:text-foreground relative">
            <Bell className="w-[18px] h-[18px]" strokeWidth={2} />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="mt-1 w-[380px] p-0 bg-surface-dialog border border-border rounded-2xl overflow-hidden  scrollbar-hide"
      >
        <div className="px-5 pt-5 pb-4 flex flex-col gap-4 border-b border-border">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-foreground">
              Notifications
            </h2>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 bg-surface-subtle w-full justify-center rounded-lg p-1 border border-border">
              <button
                onClick={() => setActiveTab("all")}
                className={`px-4 py-1.5 text-sm w-full font-medium rounded-md transition-all ${
                  activeTab === "all"
                    ? "bg-surface-hover text-foreground shadow-sm"
                    : "text-text-secondary hover:text-foreground hover:bg-surface-card"
                }`}
              >
                All
              </button>
              {["Discussions", "Mentions"].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab.toLowerCase())}
                  className={`px-4 py-1.5 text-sm w-full font-medium rounded-md transition-all ${
                    activeTab === tab.toLowerCase()
                      ? "bg-surface-hover text-foreground shadow-sm"
                      : "text-text-secondary hover:text-foreground hover:bg-surface-card"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="max-h-[420px] overflow-y-auto pb-2 custom-scrollbar">
          {filteredNotifications.length === 0 ? (
            <div className="px-4 py-12 text-center text-[13px] text-text-secondary">
              No notifications found.
            </div>
          ) : (
            filteredNotifications.map((notification) => {
              const IconComponent = LucideIcons[notification.icon] || Bell;
              let formattedTime = notification.time;
              try {
                const date = new Date(notification.time);
                if (!isNaN(date.getTime())) {
                  formattedTime = formatDistanceToNow(date, {
                    addSuffix: true,
                  });
                }
              } catch (e) {}

              let extraContent = null;
              try {
                if (typeof notification.extra === "string") {
                  extraContent = JSON.parse(notification.extra);
                } else if (
                  typeof notification.extra === "object" &&
                  notification.extra !== null
                ) {
                  extraContent = notification.extra;
                }
              } catch (e) {}

              const isUnread = !notification.read;
              const bgColor = notification.bg_color || notification.bgColor || "bg-surface-card";
              const iconColor = notification.icon_color || notification.iconColor || "text-text-secondary";

              return (
                <div
                  key={notification.id}
                  className={`px-4 py-3.5 transition-colors relative group cursor-pointer border-b border-[#1a1a1a] last:border-b-0 ${
                    isUnread
                      ? "bg-surface-subtle/50 hover:bg-surface-card"
                      : "hover:bg-surface-card"
                  }`}
                >
                  {isUnread && (
                    <div className="absolute left-1.5 top-5 w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                  )}

                  <div className="pl-3 flex items-start gap-3">
                    <div
                      className={`mt-0.5 flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${bgColor} border border-white/[0.06]`}
                    >
                      <IconComponent
                        className={`w-4 h-4 ${iconColor}`}
                        strokeWidth={1.8}
                      />
                    </div>

                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <h3
                          className={`text-[13px] font-medium truncate ${
                            isUnread ? "text-foreground" : "text-muted-foreground"
                          }`}
                        >
                          {notification.title}
                        </h3>
                        <span className="text-[11px] text-text-tertiary whitespace-nowrap shrink-0">
                          {formattedTime}
                        </span>
                      </div>
                      <p
                        className={`text-[12px] leading-relaxed ${
                          isUnread ? "text-muted-foreground" : "text-text-secondary"
                        } line-clamp-2`}
                      >
                        {notification.description}
                      </p>

                      {extraContent && (
                        <div className="mt-3">
                      {extraContent.type === "comment" && (
                            <div className="bg-surface-subtle border border-border rounded-lg p-3 text-[12px] text-muted-foreground leading-relaxed">
                              {extraContent.text}
                            </div>
                          )}

                          {extraContent.type === "discussion" && (
                            <div className="bg-surface-subtle border border-border rounded-lg p-3 text-[12px] text-muted-foreground leading-relaxed">
                              <div className="flex items-center justify-between gap-2 mb-2">
                                <span className="inline-flex items-center gap-1.5 text-foreground font-medium">
                                  <MessageSquare className="w-3.5 h-3.5 text-emerald-300" />
                                  {extraContent.channel}
                                </span>
                                <span className="text-[10px] text-text-secondary">
                                  {extraContent.replies} replies
                                </span>
                              </div>
                              <p className="text-muted-foreground">{extraContent.message}</p>
                              <div className="mt-3 flex items-center justify-between gap-3">
                                <span className="text-[11px] text-text-secondary">
                                  Started by {extraContent.author}
                                </span>
                                <div className="flex -space-x-1">
                                  {extraContent.participants?.map((person) => (
                                    <span
                                      key={person}
                                      className="flex h-5 w-5 items-center justify-center rounded-full border border-[#1a1a1a] bg-surface-hover text-[9px] font-semibold text-foreground"
                                    >
                                      {person}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}

                          {extraContent.type === "file" &&
                            extraContent.files?.map((f, i) => (
                              <div
                                key={i}
                                className="flex items-center justify-between p-2.5 border border-border rounded-lg bg-surface-subtle mt-2"
                              >
                                <div className="flex items-center gap-2.5 overflow-hidden">
                                  <div className="w-7 h-7 rounded flex items-center justify-center bg-surface-card text-text-secondary text-[10px] font-medium">
                                    {f.name.split('.').pop().toUpperCase()}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-[12px] text-muted-foreground truncate">
                                      {f.name}
                                    </div>
                                    <div className="text-[10px] text-text-secondary">
                                      {f.size}
                                    </div>
                                  </div>
                                </div>
                                <button
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:text-foreground hover:bg-surface-hover transition-colors shrink-0"
                                >
                                  <Download className="w-4 h-4" />
                                </button>
                              </div>
                            ))}

                          {extraContent.type === "actions" && (
                            <div className="flex items-center gap-2 mt-2.5">
                              <button
                                onClick={(e) => e.stopPropagation()}
                                className="px-3 py-1.5 rounded-lg border border-border text-[11px] font-medium text-muted-foreground hover:bg-surface-active hover:text-foreground transition-colors"
                              >
                                {extraContent.options?.[0] || "Decline"}
                              </button>
                              <button
                                onClick={(e) => e.stopPropagation()}
                                className="px-3 py-1.5 rounded-lg bg-foreground text-[11px] font-medium text-black hover:bg-gray-200 transition-colors"
                              >
                                {extraContent.options?.[1] || "Accept"}
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="mt-3">
                        <span className="text-[9px] uppercase font-semibold tracking-wider text-text-secondary bg-surface-card px-2 py-1 rounded-md border border-border">
                          {notification.type}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
