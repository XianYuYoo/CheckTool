// 扩展安装或更新时初始化
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    // 初始化存储
    chrome.storage.local.set({
      tasks: [],
      settings: {
        defaultCheckInterval: 60, // 默认检查间隔（分钟）
        maxHistory: 100,
        notificationDuration: 3000  // 通知持续时间改为3秒
      }
    });
  }
  
  // 创建右键菜单（不管什么原因，都重新创建菜单）
  setupContextMenu();
});

// 扩展启动时也创建右键菜单
chrome.runtime.onStartup.addListener(() => {
  setupContextMenu();
  // 恢复所有启用的监控任务
  restoreActiveTasks();
});

// 设置右键菜单
function setupContextMenu() {
  // 先清除所有已有的菜单项，避免重复
  chrome.contextMenus.removeAll(() => {
    // 重新创建菜单
    chrome.contextMenus.create({
      id: 'monitorElement',
      title: '监控此页面元素',
      contexts: ['page', 'selection']
    });
    
    console.log('右键菜单已创建');
  });
}

// 恢复活动任务
function restoreActiveTasks() {
  chrome.storage.local.get('tasks', ({tasks}) => {
    if (Array.isArray(tasks)) {
      // 重新安排所有启用的任务
      tasks.forEach(task => {
        if (task.enabled) {
          scheduleTask(task);
        }
      });
      console.log('已恢复所有活动监控任务');
    }
  });
}

// 处理右键菜单点击事件
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'monitorElement') {
    // 在当前页面启动元素选择器
    chrome.tabs.sendMessage(tab.id, {action: 'startSelection'});
  } else if (info.menuItemId === 'openDashboard') {
    // 打开监控控制面板
    openDashboard();
  }
});

// 打开控制面板
function openDashboard() {
  // 检查是否已经有控制面板页面打开
  chrome.tabs.query({url: chrome.runtime.getURL('index.html'), pinned: true}, (tabs) => {
    if (tabs.length > 0) {
      // 如果已经有控制面板页面，则激活它
      chrome.tabs.update(tabs[0].id, {active: true});
    } else {
      // 否则，创建一个新的控制面板页面
      chrome.tabs.create({url: chrome.runtime.getURL('index.html'),pinned: true});
    }
  });
}

// 处理来自content script或页面的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('收到消息:', message);
  
  if (message.action === 'openMonitorPage') {
    // 先检查是否已有扩展页面打开
    chrome.tabs.query({
      url: chrome.runtime.getURL('index.html')
    }, (tabs) => {
      if (tabs && tabs.length > 0) {
        // 已有扩展页面打开，直接激活现有标签页
        chrome.tabs.update(tabs[0].id, { active: true }, (tab) => {
          // 处理可能的错误
          if (chrome.runtime.lastError) {
            console.error('激活标签页失败:', chrome.runtime.lastError);
            // 创建新标签页作为备选方案
            createNewMonitorTab(message.data);
            return;
          }
          
          // 发送数据到现有页面
          if (message.data) {
            setTimeout(() => {
              chrome.tabs.sendMessage(tab.id, {
                action: 'updateContent',
                data: message.data
              }, (response) => {
                // 处理发送消息可能的错误
                if (chrome.runtime.lastError) {
                  console.warn('向现有标签页发送数据失败，尝试重新加载:', chrome.runtime.lastError);
                  // 尝试重新加载页面
                  chrome.tabs.reload(tab.id);
                }
              });
            }, 300); // 给页面一些时间准备
          }
        });
      } else {
        // 没有现有扩展页面，创建新的标签页
        createNewMonitorTab(message.data);
      }
    });
    return true; // 异步响应
  }
  
  else if (message.action === 'checkWebsiteContent') {
    checkWebsiteContent(message.task)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({error: error.message}));
    return true; // 异步响应
  }
  
  else if (message.action === 'scheduleTask') {
    scheduleTask(message.task);
    sendResponse({success: true});
  }
  
  else if (message.action === 'cancelTask') {
    cancelTask(message.taskId);
    sendResponse({success: true});
  }
  
  else if (message.action === 'testSelector') {
    testSelector(message.url, message.selector, message.selectorType)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({error: error.message}));
    return true; // 异步响应
  }
  
  else if (message.action === 'getFavicon') {
    getFavicon(message.url)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({error: error.message, success: false}));
    return true; // 异步响应
  }
});

// 设置定时任务
function scheduleTask(task) {
  const alarmName = `task_${task.id}`;
  
  // 取消现有的定时器（如果存在）
  chrome.alarms.clear(alarmName, () => {
    // 设置新的定时器
    if (task.enabled) {
      const minutes = task.checkInterval || 60; // 默认60分钟
      chrome.alarms.create(alarmName, {
        periodInMinutes: minutes
      });
      console.log(`已安排任务 ${task.id}，间隔：${minutes}分钟`);
    }
  });
}

// 取消定时任务
function cancelTask(taskId) {
  const alarmName = `task_${taskId}`;
  chrome.alarms.clear(alarmName);
  console.log(`已取消任务 ${taskId}`);
}

// 任务队列管理，避免同时打开大量标签页
const taskQueue = [];
let isProcessingQueue = false;

// 添加任务到队列
function addTaskToQueue(task) {
  taskQueue.push(task);
  if (!isProcessingQueue) {
    processTaskQueue();
  }
}

// 处理任务队列
async function processTaskQueue() {
  if (taskQueue.length === 0) {
    isProcessingQueue = false;
    return;
  }
  
  isProcessingQueue = true;
  const task = taskQueue.shift();
  
  try {
    console.log(`处理队列中的任务: ${task.id}`);
    const result = await checkWebsiteContent(task);
    
    // 处理任务结果
    if (result.hasChanged) {
      await handleContentChange(task, result.content);
    } else {
      await updateLastCheckTime(task);
    }
  } catch (error) {
    console.error(`处理队列任务 ${task.id} 失败:`, error);
  }
  
  // 延迟一点时间再处理下一个任务，避免浏览器负载过高
  setTimeout(() => {
    processTaskQueue();
  }, 1000);
}

// 根据变更频率智能调整检查间隔
function adjustCheckInterval(task) {
  // 如果没有足够的变更历史，不调整
  if (!task.changeHistory || task.changeHistory.length < 3) return task;
  
  // 分析最近的几次变更时间
  const recentChanges = task.changeHistory.slice(-3);
  const intervals = [];
  
  for (let i = 1; i < recentChanges.length; i++) {
    const prevTime = new Date(recentChanges[i-1].changeTime).getTime();
    const currTime = new Date(recentChanges[i].changeTime).getTime();
    intervals.push((currTime - prevTime) / (60 * 1000)); // 转换为分钟
  }
  
  // 计算平均变更间隔
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  
  // 根据平均变更间隔调整检查频率，但确保在合理范围内
  // 设定为平均间隔的80%，确保能捕获到变化，最小1分钟，最大1天
  let newInterval = Math.max(Math.min(Math.round(avgInterval * 0.8), 1440), 1);
  
  // 只有当新间隔与当前间隔差异较大时才调整
  if (Math.abs(newInterval - task.checkInterval) > task.checkInterval * 0.3) {
    console.log(`为任务 ${task.id} 自动调整检查间隔: ${task.checkInterval} -> ${newInterval} 分钟`);
    
    // 更新任务的检查间隔
    const updatedTask = { ...task, checkInterval: newInterval };
    
    // 重新调度任务
    scheduleTask(updatedTask);
    
    return updatedTask;
  }
  
  return task;
}

// 处理内容变更
async function handleContentChange(task, newContent) {
  try {
    console.log(`任务 ${task.id} 检测到内容变更`);
    
    // 显示通知
    chrome.notifications.create(`notification_${task.id}_${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '内容变更检测',
      message: `${task.title} 的内容已更新`,
      priority: 2
    });
    
    // 更新任务状态
    const { tasks } = await chrome.storage.local.get('tasks');
    const updatedTasks = tasks.map(t => {
      if (t.id === task.id) {
        const changeTime = new Date().toISOString();
        
        // 准备更新后的任务
        let updatedTask = {
          ...t,
          lastCheck: changeTime,
          currentContent: newContent
        };
        
        // 添加到变更历史
        if (!updatedTask.changeHistory) {
          updatedTask.changeHistory = [];
        }
        
        // 添加新的变更记录
        updatedTask.changeHistory.push({
          id: `change_${t.id}_${Date.now()}`,
          content: newContent,
          changeTime: changeTime
        });
        
        // 限制历史记录数量
        const { settings } = tasks.find(t => t.id === 'settings') || { settings: { maxHistory: 100 } };
        const maxHistory = settings.maxHistory || 100;
        
        if (updatedTask.changeHistory.length > maxHistory) {
          updatedTask.changeHistory = updatedTask.changeHistory.slice(-maxHistory);
        }
        
        // 智能调整检查间隔
        updatedTask = adjustCheckInterval(updatedTask);
        
        return updatedTask;
      }
      return t;
    });
    
    await chrome.storage.local.set({ tasks: updatedTasks });
    
    // 向扩展页面发送内容变更通知
    chrome.tabs.query({url: chrome.runtime.getURL('index.html')}, (tabs) => {
      if (tabs && tabs.length > 0) {
        // 发送变更消息到扩展页面
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'contentChanged',
            taskId: task.id,
            title: task.title
          }).catch(err => console.warn('发送变更通知失败:', err));
        });
      }
    });
  } catch (error) {
    console.error('处理内容变更失败:', error);
  }
}

// 更新最后检查时间
async function updateLastCheckTime(task) {
  try {
    const { tasks } = await chrome.storage.local.get('tasks');
    const updatedTasks = tasks.map(t => {
      if (t.id === task.id) {
        return {
          ...t,
          lastCheck: new Date().toISOString()
        };
      }
      return t;
    });
    
    await chrome.storage.local.set({ tasks: updatedTasks });
  } catch (error) {
    console.error(`检查任务 ${task.id} 失败:`, error);
  }
}

// 检查网站内容
async function checkWebsiteContent(task) {
  return new Promise((resolve, reject) => {
    // 创建一个临时标签页来获取内容，不检测是否已打开
    chrome.tabs.create({
      url: task.url,
      active: false,
      pinned: true
    }, (tab) => {
      // 监听标签页加载完成
      const tabListener = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          // 页面加载完成，执行内容脚本
          chrome.tabs.sendMessage(tab.id, {
            action: 'extractContent',
            selector: task.selector,
            selectorType: task.selectorType || 'css'
          }, (response) => {
            // 关闭临时标签页
            chrome.tabs.remove(tab.id);
            chrome.tabs.onUpdated.removeListener(tabListener);
            
            if (chrome.runtime.lastError) {
              // 处理消息发送错误
              reject(new Error('内容脚本未响应，可能是页面加载问题'));
              return;
            }
            
            if (response.error) {
              reject(new Error(response.error));
              return;
            }
            
            // 比较内容是否有变化
            const hasChanged = task.currentContent !== response.content;
            
            resolve({
              hasChanged,
              content: response.content
            });
          });
        }
      };
      
      chrome.tabs.onUpdated.addListener(tabListener);
      
      // 设置超时，以防页面加载失败
      setTimeout(() => {
        chrome.tabs.get(tab.id, (tabInfo) => {
          if (chrome.runtime.lastError) {
            return;
          }
          
          if (tabInfo) {
            chrome.tabs.remove(tab.id);
            chrome.tabs.onUpdated.removeListener(tabListener);
            reject(new Error('页面加载超时'));
          }
        });
      }, 30000); // 30秒超时
    });
  });
}

// 测试选择器
async function testSelector(url, selector, selectorType) {
  return new Promise((resolve, reject) => {
    // 创建一个新标签页，设置为激活状态以便用户可以看到
    chrome.tabs.create({url, active: false, pinned: true}, (newTab) => {
      let tab = newTab;
      
      // 定义一个函数，在页面加载完成后进行测试
      const tabListener = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          console.log('页面加载完成，准备测试选择器');
          
          // 移除监听器
          chrome.tabs.onUpdated.removeListener(tabListener);
          
          // 延迟一段时间，等待页面完全渲染
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, {
              action: 'testSelector',
              selector: selector,
              selectorType: selectorType || 'css'
            }, (response) => {
              // 关闭临时标签页
              chrome.tabs.remove(tab.id);
              
              if (chrome.runtime.lastError) {
                reject(new Error('内容脚本未响应，可能是页面加载问题'));
                return;
              }
              
              resolve(response);
            });
          }, 2000); // 给页面2秒时间完成动态内容加载
        }
      };
      
      // 添加Tab更新事件监听器
      chrome.tabs.onUpdated.addListener(tabListener);
      
      // 设置超时，以防页面加载失败
      setTimeout(() => {
        chrome.tabs.get(tab.id, (tabInfo) => {
          if (chrome.runtime.lastError) {
            // 标签页可能已经被关闭
            return;
          }
          
          if (tabInfo) {
            chrome.tabs.remove(tab.id);
            chrome.tabs.onUpdated.removeListener(tabListener);
            reject(new Error('页面加载超时'));
          }
        });
      }, 30000); // 30秒超时
    });
  });
}

// 获取网页favicon
async function getFavicon(url) {
  return new Promise((resolve, reject) => {
    try {
      // 创建一个临时标签页，加载目标URL
      chrome.tabs.create({ url: url, active: false }, (tab) => {
        // 等待页面加载完成
        const tabListener = (tabId, changeInfo) => {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            // 页面加载完成，执行脚本获取favicon
            chrome.scripting.executeScript({
              target: { tabId: tab.id },
              function: extractFavicon
            }, (results) => {
              // 关闭临时标签页
              chrome.tabs.remove(tab.id);
              
              if (chrome.runtime.lastError) {
                resolve({ success: false, error: chrome.runtime.lastError.message });
                return;
              }
              
              if (results && results[0] && results[0].result) {
                resolve({ success: true, faviconUrl: results[0].result });
              } else {
                resolve({ success: false });
              }
            });
            
            // 移除监听器
            chrome.tabs.onUpdated.removeListener(tabListener);
          }
        };
        
        chrome.tabs.onUpdated.addListener(tabListener);
        
        // 设置超时，防止长时间等待
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(tabListener);
          chrome.tabs.remove(tab.id);
          resolve({ success: false, error: '获取favicon超时' });
        }, 10000); // 10秒超时
      });
    } catch (error) {
      reject(error);
    }
  });
}

// 从页面提取favicon的函数
function extractFavicon() {
  // 按优先级查找favicon
  const iconSelectors = [
    'link[rel="icon"][href]',
    'link[rel="shortcut icon"][href]',
    'link[rel="apple-touch-icon"][href]',
    'link[rel="apple-touch-icon-precomposed"][href]',
    'link[rel="fluid-icon"][href]',
    'link[rel="mask-icon"][href]',
    'link[rel="alternate icon"][href]',
    'meta[property="og:image"][content]'
  ];
  
  for (const selector of iconSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      if (selector.includes('meta')) {
        return element.getAttribute('content');
      } else {
        return element.getAttribute('href');
      }
    }
  }
  
  // 如果没有找到任何图标，返回null
  return null;
}

// 辅助函数：创建新的监控标签页
function createNewMonitorTab(data) {
  chrome.tabs.create({
    url: chrome.runtime.getURL('index.html'),
    pinned: true  // 使用固定模式打开
  }, (tab) => {
    // 等待页面加载完成后发送数据
    if (data) {
      const listener = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          // 页面加载完成，发送数据
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, {
              action: 'updateContent',
              data: data
            }, (response) => {
              // 检测可能的错误
              if (chrome.runtime.lastError) {
                console.error('向新标签页发送数据失败:', chrome.runtime.lastError);
              }
            });
          }, 500); // 给页面一些时间初始化JS
          chrome.tabs.onUpdated.removeListener(listener);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      
      // 设置超时以防页面加载失败
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
      }, 10000); // 10秒后移除监听器，避免内存泄漏
    }
  });
}

// 增加资源管理功能，清理未关闭的标签页
function cleanupOrphanedTabs() {
  try {
    // 检查是否有监控相关的孤立标签页
    const extensionUrl = chrome.runtime.getURL('');
    chrome.tabs.query({
      url: extensionUrl + '*',
      pinned: true
    }, (tabs) => {
      // 只保留控制面板页面，关闭临时监控页面
      tabs.forEach(tab => {
        if (tab.url !== chrome.runtime.getURL('index.html')) {
          chrome.tabs.remove(tab.id).catch(err => {
            console.warn('关闭孤立标签页失败:', err);
          });
        }
      });
      
      console.log(`已清理${tabs.length}个监控相关的孤立标签页`);
    });
  } catch (error) {
    console.error('清理孤立标签页失败:', error);
  }
}

// 定期执行资源清理（每小时一次）
chrome.alarms.create('cleanup', {
  periodInMinutes: 60
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'cleanup') {
    cleanupOrphanedTabs();
  }
}); 