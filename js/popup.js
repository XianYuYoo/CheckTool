// 加载统计数据
function loadStats() {
  chrome.storage.local.get(['tasks'], (result) => {
    const tasks = result.tasks || [];
    const totalTasks = tasks.length;
    const activeTasks = tasks.filter(t => t.enabled).length;
    
    // 计算最近24小时的变更
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    const recentChanges = tasks.filter(task => {
      if (!task.lastChange) return false;
      const changeTime = new Date(task.lastChange);
      return changeTime > oneDayAgo;
    }).length;
    
    // 更新显示
    document.getElementById('total-tasks').textContent = totalTasks;
    document.getElementById('active-tasks').textContent = activeTasks;
    document.getElementById('recent-changes').textContent = recentChanges;
  });
}

// 打开控制面板
function openDashboard() {
  // 检查是否已经有控制面板页面打开
  chrome.tabs.query({url: chrome.runtime.getURL('index.html'),pinned: true}, (tabs) => {
    if (tabs.length > 0) {
      // 如果已经有控制面板页面，则激活它
      chrome.tabs.update(tabs[0].id, {active: true});
    } else {
      // 否则，创建一个新的控制面板页面
      chrome.tabs.create({url: chrome.runtime.getURL('index.html'),pinned: true});
    }
    
    // 关闭popup
    window.close();
  });
}

// 监控当前页面
function monitorCurrentPage() {
  // 获取当前活动标签页
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    if (tabs.length > 0) {
      const currentTab = tabs[0];
      
      // 发送消息到当前页面启动选择器
      chrome.tabs.sendMessage(currentTab.id, {action: 'startSelection'}, (response) => {
        // 处理可能的消息发送错误
        if (chrome.runtime.lastError) {
          alert('无法在此页面启动选择器: ' + chrome.runtime.lastError.message);
          return;
        }
        
        // 关闭popup
        window.close();
      });
    }
  });
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  // 加载统计数据
  loadStats();
  
  // 添加按钮事件监听器
  document.getElementById('open-dashboard').addEventListener('click', openDashboard);
  document.getElementById('monitor-current').addEventListener('click', monitorCurrentPage);
}); 