import { TaskWorkspace } from "@/components/TaskWorkspace";

export default async function TaskPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  return <TaskWorkspace taskId={taskId} />;
}
