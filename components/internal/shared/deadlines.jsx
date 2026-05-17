import React from "react";
import { Calendar, Clock, AlertCircle, ChevronRight } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const users = [
  { id: 1, name: "User 1", src: "https://i.pravatar.cc/150?u=1" },
  { id: 2, name: "User 2", src: "https://i.pravatar.cc/150?u=2" },
  { id: 3, name: "User 3", src: "https://i.pravatar.cc/150?u=3" },
];

const deadlines = [
  {
    id: 1,
    title: "v1.5 Beta Launch",
    date: "Mar 15, 2026",
    priority: "High",
    progress: 75,
    color: "#f59e0b",
    remaining: "14 days left",
  },
  {
    id: 2,
    title: "Security Audit",
    date: "Mar 22, 2026",
    priority: "Critical",
    progress: 40,
    color: "#ef4444",
    remaining: "21 days left",
  },
  {
    id: 3,
    title: "User Feedback Review",
    date: "Apr 05, 2026",
    priority: "Medium",
    progress: 10,
    color: "#3b82f6",
    remaining: "35 days left",
  },
  {
    id: 4,
    title: "API Documentation",
    date: "Apr 12, 2026",
    priority: "Low",
    progress: 90,
    color: "#10b981",
    remaining: "42 days left",
  },
];

export function DeadlinesSection() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#e7e7e7] tracking-tight leading-tight">
              Upcoming Deadlines
            </h2>
            <p className="text-xs text-[#737373]">
              Tasks requiring immediate attention
            </p>
          </div>
        </div>
        <button className="text-xs font-medium text-[#737373] hover:text-[#e7e7e7] px-3 py-1.5 rounded-lg transition-colors hover:border-[#474747] flex items-center gap-2">
          View Schedule <ChevronRight className="w-3 h-3" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {deadlines.map((deadline) => (
          <Card
            key={deadline.id}
            className="bg-[#202020] border-[#2a2a2a] hover:border-[#474747] transition-colors flex flex-col justify-between py-0 gap-0"
          >
            <CardHeader className="p-5 pb-0 space-y-4">
              <div className="flex items-center justify-between">
                <span
                  className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded border"
                  style={{
                    color: deadline.color,
                    borderColor: `${deadline.color}50`,
                    backgroundColor: `${deadline.color}10`,
                  }}
                >
                  {deadline.priority} Priority
                </span>
                <span className="text-sm font-medium text-[#a3a3a3]">
                  {deadline.progress}%
                </span>
              </div>
              <CardTitle className="text-[#e7e7e7] font-medium text-base">
                {deadline.title}
              </CardTitle>
            </CardHeader>

            <CardContent className="p-5 pt-4 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-[#737373]">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Time Left</span>
                </div>
                <span className="text-[#e7e7e7]">{deadline.remaining}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-[#737373]">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Due Date</span>
                </div>
                <span className="text-[#e7e7e7]">{deadline.date}</span>
              </div>

              <div className="w-full h-1 bg-[#161616] rounded-full mt-4 overflow-hidden border border-[#2a2a2a]">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${deadline.progress}%`,
                    backgroundColor: deadline.color,
                  }}
                />
              </div>
            </CardContent>

            <CardFooter className="p-5 pt-4 border-t border-[#2a2a2a] flex items-center justify-between">
              <div className="flex -space-x-2">
                {users.map((user) => (
                  <Avatar key={user.id} className="w-6 h-6 border-2 border-[#202020]">
                    <AvatarImage src={user.src} alt={user.name} />
                    <AvatarFallback className="text-[9px] bg-[#333333] text-[#a3a3a3]">
                      {user.name.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                ))}
              </div>
              <button className="text-[11px] font-medium text-[#737373] hover:text-[#e7e7e7] transition-colors">
                Open Task
              </button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
