/**
 * 网页内容监控扩展 - 主应用文件
 */

// 主应用类
class WebMonitorApp {
  constructor() {
    this.tasks = [];
    this.settings = {
      defaultCheckInterval: 60, // 默认检查间隔（分钟）
      enableNotifications: true,
      retryOnError: true,
      maxRetries: 3,
      maxHistory: 100
    };
    
    // 添加一个计时器用于定期刷新动态内容
    this.refreshTimers = {
      changes: null,
      tasks: null
    };

    // 默认刷新间隔（毫秒）
    this.refreshInterval = 30000; // 30秒

    // 当前查看的部分
    this.currentSection = 'home';

    this.init();
  }
  
  async init() {
    // 加载任务和设置
    await this.loadData();
    
    // 初始化应用
    this.initNavigation();
    
    // 根据 URL 参数或 hash 确定初始页面
    this.handleInitialNavigation();
    
    // 监听消息
    this.setupMessageListener();
  }
  
  // 加载存储的数据
  async loadData() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['tasks', 'settings'], (result) => {
        if (result.tasks) {
          this.tasks = result.tasks;
        }
        
        if (result.settings) {
          this.settings = {...this.settings, ...result.settings};
        }
        
        resolve();
      });
    });
  }
  
  // 保存任务到存储
  async saveTasks() {
    return new Promise((resolve) => {
      chrome.storage.local.set({tasks: this.tasks}, resolve);
    });
  }
  
  // 保存设置到存储
  async saveSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.set({settings: this.settings}, resolve);
    });
  }

  // 添加任务
  async addTask(taskData) {
    // 生成唯一ID
    const taskId = 'task_' + Date.now();
    
    const newTask = {
      id: taskId,
      title: taskData.title || '未命名任务',
      url: taskData.url,
      selector: taskData.selector,
      selectorType: taskData.selectorType || 'css',
      xpathSelector: taskData.xpathSelector,
      checkInterval: taskData.checkInterval || this.settings.defaultCheckInterval,
      enabled: true,
      createdAt: new Date().toISOString(),
      lastCheck: null,
      currentContent: taskData.content || '',
      changeHistory: [],
      favicon: taskData.favicon || ''
    };
    
    this.tasks.push(newTask);
    await this.saveTasks();
    
    // 设置定时器
    this.scheduleTask(newTask);
    
    return newTask;
  }
  
  // 更新任务
  async updateTask(taskId, updates) {
    const taskIndex = this.tasks.findIndex(t => t.id === taskId);
    
    if (taskIndex !== -1) {
      const updatedTask = {...this.tasks[taskIndex], ...updates};
      this.tasks[taskIndex] = updatedTask;
      await this.saveTasks();
      
      // 重新设置定时器
      this.scheduleTask(updatedTask);
      
      return updatedTask;
    }
    
    return null;
  }
  
  // 删除任务
  async deleteTask(taskId) {
    const taskIndex = this.tasks.findIndex(t => t.id === taskId);
    
    if (taskIndex !== -1) {
      // 取消定时器
      this.cancelTask(this.tasks[taskIndex]);
      
      // 从数组移除
      this.tasks.splice(taskIndex, 1);
      await this.saveTasks();
      
      return true;
    }
    
    return false;
  }
  
  // 设置任务定时器
  scheduleTask(task) {
    chrome.runtime.sendMessage({
      action: 'scheduleTask',
      task: task
    });
  }
  
  // 取消任务定时器
  cancelTask(task) {
    chrome.runtime.sendMessage({
      action: 'cancelTask',
      taskId: task.id
    });
  }
  
  // 测试选择器
  async testSelector(url, selector, selectorType) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'testSelector',
        url: url,
        selector: selector,
        selectorType: selectorType
      }, (response) => {
        resolve(response);
      });
    });
  }
  
  // 设置消息监听器
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('收到消息:', message);
      
      if (message.action === 'updateContent') {
        this.handleUpdateContent(message.data);
        sendResponse({success: true});
      }
      
      // 添加监听内容变更通知的处理
      if (message.action === 'contentChanged') {
        console.log('收到内容变更通知', message.taskId);
        
        // 根据当前所在部分刷新不同的内容
        if (this.currentSection === 'changes') {
          this.loadChangesList();
        } else if (this.currentSection === 'tasks') {
          this.loadTasksList();
        } else if (this.currentSection === 'home') {
          this.loadRecentActivity();
        }
        
        // 显示通知消息
        this.showMessage('监控内容有更新', 'info');
        
        sendResponse({success: true});
      }
      
      return true;
    });
  }
  
  // 处理更新内容消息
  handleUpdateContent(data) {
    if (data.type === 'createTask') {
      // 如果当前不在任务编辑页面，跳转过去
      const taskForm = document.getElementById('task-form');
      if (!taskForm) {
        this.navigateToSection('tasks');
        setTimeout(() => {
          this.showTaskEditForm(data);
        }, 100);
      } else {
        this.showTaskEditForm(data);
      }
    }
  }

  handleInitialNavigation() {
    // 检查 URL 参数
    const urlParams = new URLSearchParams(window.location.search);
    const section = urlParams.get('section');
    
    if (section) {
      this.loadContent(section);
      this.updateActiveNavLink(section); // 更新导航菜单状态
      return;
    }
    
    // 检查 hash
    const hash = window.location.hash.replace('#', '');
    if (hash) {
      this.loadContent(hash);
      this.updateActiveNavLink(hash); // 更新导航菜单状态
      return;
    }
    
    // 默认加载首页
    this.loadContent('home');
    this.updateActiveNavLink('home'); // 确保默认页显示正确活动菜单
  }

  // 新增方法，用于更新活动菜单链接
  updateActiveNavLink(section) {
    const navLinks = document.querySelectorAll(".main-nav a");
    navLinks.forEach(link => {
      if (link.getAttribute("data-section") === section) {
        link.classList.add("active");
      } else {
        link.classList.remove("active");
      }
    });
  }

  initNavigation() {
    // 初始化导航
    const navLinks = document.querySelectorAll(".main-nav a");
    navLinks.forEach(link => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const section = link.getAttribute("data-section");
        this.navigateToSection(section);
      });
    });
  }

  navigateToSection(section) {
    // 更新活动链接
    this.updateActiveNavLink(section);

    // 加载相应内容
    this.loadContent(section);

    // 更新URL哈希
    window.location.hash = section;
  }

  // 设置内容刷新计时器
  setupContentRefresh(section) {
    // 清除所有现有的计时器
    this.clearRefreshTimers();
    
    // 不再使用定时刷新，改为有通知时刷新
    console.log(`内容刷新模式已改为：有变更通知时刷新 - ${section}`);
    
    // 将当前部分保存起来，在接收到变更通知时使用
    this.currentSection = section;
  }
  
  // 清除所有内容刷新计时器
  clearRefreshTimers() {
    Object.keys(this.refreshTimers).forEach(key => {
      if (this.refreshTimers[key]) {
        clearInterval(this.refreshTimers[key]);
        this.refreshTimers[key] = null;
      }
    });
  }

  // 加载内容
  loadContent(section) {
    const contentContainer = document.getElementById('content-container');
    if (!contentContainer) return;
    
    // 更新当前部分
    this.currentSection = section;
    
    // 获取对应模板
    const templateId = section + '-template';
    const template = document.getElementById(templateId);
    
    if (!template) {
      console.error(`找不到模板: ${templateId}`);
      return;
    }
    
    // 克隆模板内容
    const content = template.content.cloneNode(true);
    
    // 清空当前内容并添加新内容
    contentContainer.innerHTML = '';
    contentContainer.appendChild(content);
    
    // 根据部分初始化特定的功能
    switch (section) {
      case 'home':
        this.initHomeSection();
        break;
      case 'changes':
        this.initChangesSection();
        // 设置变更页面的自动刷新
        this.setupContentRefresh('changes');
        break;
      case 'tasks':
        this.initTasksSection();
        // 设置任务页面的自动刷新
        this.setupContentRefresh('tasks');
        break;
      case 'settings':
        this.initSettingsSection();
        break;
    }
  }

  initHomeSection() {
    // 更新统计信息
    const totalTasks = this.tasks.length;
    const activeTasks = this.tasks.filter(t => t.enabled).length;
    const recentChanges = this.countRecentChanges();
    
    document.getElementById("total-tasks").textContent = totalTasks;
    document.getElementById("active-tasks").textContent = activeTasks;
    document.getElementById("recent-changes").textContent = recentChanges;

    // 添加按钮事件监听器
    const createTaskBtn = document.getElementById("create-task-btn");
    if (createTaskBtn) {
      createTaskBtn.addEventListener("click", () => {
        this.navigateToSection("tasks");
        setTimeout(() => {
          this.showTaskEditForm();
        }, 100);
      });
    }

    const viewTasksBtn = document.getElementById("view-tasks-btn");
    if (viewTasksBtn) {
      viewTasksBtn.addEventListener("click", () => {
        this.navigateToSection("tasks");
      });
    }
    
    // 加载最近活动
    this.loadRecentActivity();
  }
  
  countRecentChanges() {
    // 计算过去24小时内的变更数量
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    return this.tasks.filter(task => {
      if (!task.changeHistory || task.changeHistory.length === 0) return false;
      const changeTime = new Date(task.changeHistory[task.changeHistory.length - 1].changeTime);
      return changeTime > oneDayAgo;
    }).length;
  }
  
  loadRecentActivity() {
    const activityList = document.getElementById('recent-activity-list');
    if (!activityList) return;
    
    // 获取有变更记录的任务
    const tasksWithChanges = this.tasks
      .filter(task => task.changeHistory && task.changeHistory.length > 0)
      .sort((a, b) => new Date(b.changeHistory[b.changeHistory.length - 1].changeTime) - new Date(a.changeHistory[a.changeHistory.length - 1].changeTime))
      .slice(0, 20); // 只显示最近20条
    
    if (tasksWithChanges.length === 0) {
      activityList.innerHTML = `
        <div class="empty-state">
          <p>暂无活动记录</p>
        </div>
      `;
      return;
    }
    
    activityList.innerHTML = '';
    
    tasksWithChanges.forEach(task => {
      const activityItem = document.createElement('div');
      activityItem.className = 'activity-item';
      
      const changeTime = new Date(task.changeHistory[task.changeHistory.length - 1].changeTime);
      const timeAgo = this.getTimeAgo(changeTime);
      
      activityItem.innerHTML = `
        <div class="activity-icon">
          <img src="${task.favicon || 'icons/icon16.png'}" alt="">
        </div>
        <div class="activity-info">
          <div class="activity-title">${task.title}</div>
          <div class="activity-time">${timeAgo}</div>
        </div>
      `;
      
      activityItem.addEventListener('click', () => {
        this.navigateToSection('changes');
        setTimeout(() => {
          // 滚动到对应变更
          const changeElement = document.querySelector(`[data-task-id="${task.id}"]`);
          if (changeElement) {
            changeElement.scrollIntoView({behavior: 'smooth'});
            changeElement.classList.add('highlight');
            setTimeout(() => {
              changeElement.classList.remove('highlight');
            }, 2000);
          }
        }, 100);
      });
      
      activityList.appendChild(activityItem);
    });
  }
  
  getTimeAgo(date) {
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    
    if (diffInSeconds < 60) {
      return '刚刚';
    }
    
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) {
      return `${diffInMinutes}分钟前`;
    }
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) {
      return `${diffInHours}小时前`;
    }
    
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 30) {
      return `${diffInDays}天前`;
    }
    
    const diffInMonths = Math.floor(diffInDays / 30);
    if (diffInMonths < 12) {
      return `${diffInMonths}个月前`;
    }
    
    return `${Math.floor(diffInMonths / 12)}年前`;
  }

  initTasksSection() {
    // 加载任务列表
    this.loadTasksList();
    
    // 初始化任务列表功能
    const addTaskBtn = document.getElementById("add-task-btn");
    if (addTaskBtn) {
      addTaskBtn.addEventListener("click", () => {
        this.showTaskEditForm();
      });
    }

    const createFirstTaskBtn = document.getElementById("create-first-task-btn");
    if (createFirstTaskBtn) {
      createFirstTaskBtn.addEventListener("click", () => {
        this.showTaskEditForm();
      });
    }

    // 任务搜索功能
    const taskSearchInput = document.getElementById("task-search");
    const taskSearchBtn = document.getElementById("task-search-btn");
    
    if (taskSearchInput && taskSearchBtn) {
      const performSearch = () => {
        const searchTerm = taskSearchInput.value.trim().toLowerCase();
        this.filterTasksBySearch(searchTerm);
      };
      
      taskSearchBtn.addEventListener("click", performSearch);
      taskSearchInput.addEventListener("keyup", (e) => {
        if (e.key === "Enter") {
          performSearch();
        }
      });
    }

    // 任务分组切换
    const groupBtns = document.querySelectorAll(".group-btn");
    groupBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        groupBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const group = btn.getAttribute("data-group");
        this.filterTasks(group);
      });
    });
  }
  
  loadTasksList() {
    const tasksList = document.getElementById('tasks-list');
    if (!tasksList) return;
    
    // 记住当前滚动位置
    const scrollPosition = tasksList.scrollTop;
    
    if (this.tasks.length === 0) {
      tasksList.innerHTML = `
        <div class="empty-state">
          <p>暂无监控任务</p>
          <button class="btn btn-primary" id="create-first-task-btn">创建第一个任务</button>
        </div>
      `;
      
      const createFirstTaskBtn = document.getElementById("create-first-task-btn");
      if (createFirstTaskBtn) {
        createFirstTaskBtn.addEventListener("click", () => {
          this.showTaskEditForm();
        });
      }
      
      return;
    }
    
    // 保存当前分组和搜索状态
    const activeGroupBtn = document.querySelector('.group-btn.active');
    const activeGroup = activeGroupBtn?.getAttribute('data-group') || 'all';
    const searchInput = document.getElementById('task-search');
    const searchTerm = searchInput?.value.trim().toLowerCase() || '';
    
    // 先清空列表
    tasksList.innerHTML = '';
    
    // 根据创建时间排序，最新的在前面
    const sortedTasks = [...this.tasks].sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    );
    
    // 根据活动组筛选
    let filteredTasks = sortedTasks;
    if (activeGroup === 'active') {
      filteredTasks = sortedTasks.filter(task => task.enabled);
    } else if (activeGroup === 'inactive') {
      filteredTasks = sortedTasks.filter(task => !task.enabled);
    }
    
    // 根据搜索词筛选
    if (searchTerm.length > 0) {
      // 过滤任务
      filteredTasks = filteredTasks.filter(task => 
        task.title.toLowerCase().includes(searchTerm) || 
        task.url.toLowerCase().includes(searchTerm)
      );
    }
    
    // 创建任务元素
    filteredTasks.forEach(task => {
      this.createTaskElement(task, tasksList);
    });
    
    // 恢复滚动位置
    tasksList.scrollTop = scrollPosition;
  }
  
  createTaskElement(task, container) {
    const taskTemplate = document.getElementById('task-item-template');
    if (!taskTemplate) return;
    
    const taskElement = taskTemplate.content.cloneNode(true).querySelector('.task-item');
    
    // 设置任务ID
    taskElement.setAttribute('data-task-id', task.id);
    
    // 调整布局为如下结构:
    // [开关] [任务名称+访问图标] [检查频率和上次检查时间] [操作按钮(手动检测/编辑/删除)]
    
    // 清空原有内容，重新构建
    taskElement.innerHTML = '';
    
    // 创建开关容器 - 放到任务名称前面
    const toggleContainer = document.createElement('div');
    toggleContainer.className = 'task-toggle-container';
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'switch';
    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.className = 'task-toggle';
    toggleInput.checked = task.enabled;
    const toggleSlider = document.createElement('span');
    toggleSlider.className = 'slider round';
    
    toggleLabel.appendChild(toggleInput);
    toggleLabel.appendChild(toggleSlider);
    toggleContainer.appendChild(toggleLabel);
    taskElement.appendChild(toggleContainer);
    
    // 创建信息容器
    const infoContainer = document.createElement('div');
    infoContainer.className = 'task-info';
    
    // 创建任务名称和访问图标的容器
    const titleContainer = document.createElement('div');
    titleContainer.className = 'task-title-container';
    
    // 添加任务名称
    const titleElem = document.createElement('span');
    titleElem.className = 'task-title';
    titleElem.textContent = task.title;
    
    // 添加访问图标
    const visitButton = document.createElement('a');
    visitButton.href = task.url;
    visitButton.target = '_blank';
    visitButton.className = 'task-visit-btn';
    visitButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 6H6C4.89543 6 4 6.89543 4 8V18C4 19.1046 4.89543 20 6 20H16C17.1046 20 18 19.1046 18 18V14M14 4H20M20 4V10M20 4L10 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
    visitButton.title = "访问页面";
    
    titleContainer.appendChild(titleElem);
    titleContainer.appendChild(visitButton);
    infoContainer.appendChild(titleContainer);
    
    taskElement.appendChild(infoContainer);
    
    // 创建任务详情容器 - 放在任务名称右侧
    const detailsContainer = document.createElement('div');
    detailsContainer.className = 'task-details';
    
    // 使用标签样式显示检查频率，不显示文字说明
    const intervalBadge = document.createElement('span');
    intervalBadge.className = 'task-badge task-interval-badge';
    intervalBadge.title = `检查频率: ${this.formatInterval(task.checkInterval)}`;
    intervalBadge.textContent = `每隔${this.formatInterval(task.checkInterval)}`;
    
    // 使用标签样式显示上次检查时间，不显示文字说明
    const lastCheckBadge = document.createElement('span');
    lastCheckBadge.title = task.lastCheck ? 
      `上次检查: ${this.getTimeAgo(new Date(task.lastCheck))}` : 
      '尚未检查';
    
    if (task.lastCheck) {
      lastCheckBadge.className = 'task-badge task-lastcheck-badge';
      lastCheckBadge.textContent = this.getTimeAgo(new Date(task.lastCheck));
    } else {
      lastCheckBadge.className = 'task-badge task-nocheck-badge';
      lastCheckBadge.textContent = '尚未检查';
    }
    
    detailsContainer.appendChild(intervalBadge);
    detailsContainer.appendChild(lastCheckBadge);
    
    taskElement.appendChild(detailsContainer);
    
    // 创建操作按钮容器
    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'task-actions';
    
    // 添加手动检测按钮
    const checkButton = document.createElement('button');
    checkButton.className = 'btn task-action-btn task-check-btn';
    checkButton.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 12.6111L8.92308 17.5L20 6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="action-btn-text">手动检测</span>
    `;
    checkButton.title = "手动检测";
    
    // 添加编辑按钮
    const editButton = document.createElement('button');
    editButton.className = 'btn task-action-btn task-edit-btn';
    editButton.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M11 4H4C3.44772 4 3 4.44772 3 5V19C3 19.5523 3.44772 20 4 20H18C18.5523 20 19 19.5523 19 19V12M17.5858 3.58579C18.3668 2.80474 19.6332 2.80474 20.4142 3.58579C21.1953 4.36683 21.1953 5.63316 20.4142 6.41421L11.8284 15H9L9 12.1716L17.5858 3.58579Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="action-btn-text">编辑</span>
    `;
    editButton.title = "编辑任务";
    
    // 添加删除按钮
    const deleteButton = document.createElement('button');
    deleteButton.className = 'btn task-action-btn task-delete-btn';
    deleteButton.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19 7L18.1327 19.1425C18.0579 20.1891 17.187 21 16.1378 21H7.86224C6.81296 21 5.94208 20.1891 5.86732 19.1425L5 7M10 11V17M14 11V17M15 7V4C15 3.44772 14.5523 3 14 3H10C9.44772 3 9 3.44772 9 4V7M4 7H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="action-btn-text">删除</span>
    `;
    deleteButton.title = "删除任务";
    
    actionsContainer.appendChild(checkButton);
    actionsContainer.appendChild(editButton);
    actionsContainer.appendChild(deleteButton);
    
    taskElement.appendChild(actionsContainer);
    
    // 添加事件监听器
    toggleInput.addEventListener('change', () => {
      this.toggleTask(task.id, toggleInput.checked);
    });
    
    checkButton.addEventListener('click', async (e) => {
      e.stopPropagation(); // 防止触发任务项的点击事件
      await this.manualCheckTask(task.id);
    });
    
    editButton.addEventListener('click', (e) => {
      e.stopPropagation(); // 防止触发任务项的点击事件
      this.editTask(task.id);
    });
    
    deleteButton.addEventListener('click', (e) => {
      e.stopPropagation(); // 防止触发任务项的点击事件
      this.confirmDeleteTask(task.id);
    });
    
    // 添加到容器
    container.appendChild(taskElement);
  }
  
  formatInterval(minutes) {
    if (minutes < 60) {
      return `${minutes}分钟`;
    } else if (minutes < 1440) {
      return `${Math.floor(minutes / 60)}小时`;
    } else {
      return `${Math.floor(minutes / 1440)}天`;
    }
  }
  
  async toggleTask(taskId, enabled) {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return;
    
    await this.updateTask(taskId, {enabled});
    
    // 显示任务状态变更提示
    const statusText = enabled ? '已开启监测任务' : '已关闭监测任务';
    const preview = this.showContentPreview(`任务"${task.title}"${statusText}`, false, statusText);
    
    // 重新加载任务列表
    this.loadTasksList();
  }
  
  editTask(taskId) {
    const task = this.tasks.find(t => t.id === taskId);
    if (task) {
      this.showTaskEditForm(task);
    }
  }
  
  async confirmDeleteTask(taskId) {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return;
    
    const confirmed = await this.confirm({
      title: '确认删除',
      content: `确定要删除任务"${task.title}"吗？此操作不可撤销。`,
      confirmText: '删除',
      cancelText: '取消'
    });
    
    if (confirmed) {
      await this.deleteTask(taskId);
      this.loadTasksList();
    }
  }
  
  filterTasks(group) {
    const tasksList = document.getElementById('tasks-list');
    if (!tasksList) return;
    
    const taskElements = tasksList.querySelectorAll('.task-item');
    
    taskElements.forEach(el => {
      const taskId = el.getAttribute('data-task-id');
      const task = this.tasks.find(t => t.id === taskId);
      
      if (!task) return;
      
      if (group === 'all' || 
          (group === 'active' && task.enabled) || 
          (group === 'inactive' && !task.enabled)) {
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
    });
  }
  
  filterTasksBySearch(searchTerm) {
    const tasksList = document.getElementById('tasks-list');
    if (!tasksList) return;
    
    const taskElements = tasksList.querySelectorAll('.task-item');
    
    if (!searchTerm) {
      // 如果搜索词为空，显示所有任务
      taskElements.forEach(el => {
        el.style.display = '';
      });
      return;
    }
    
    taskElements.forEach(el => {
      const taskId = el.getAttribute('data-task-id');
      const task = this.tasks.find(t => t.id === taskId);
      
      if (!task) return;
      
      // 在标题和URL中搜索
      if (task.title.toLowerCase().includes(searchTerm) || 
          task.url.toLowerCase().includes(searchTerm)) {
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
    });
  }

  initChangesSection() {
    // 加载变更列表
    this.loadChangesList();
    
    // 初始化变更列表功能
    const clearChangesBtn = document.getElementById('clear-changes-btn');
    if (clearChangesBtn) {
      clearChangesBtn.addEventListener('click', () => {
        this.confirmClearChanges();
      });
    }
  }
  
  loadChangesList() {
    const changesList = document.getElementById('changes-list');
    if (!changesList) return;
    
    // 记住当前滚动位置
    const scrollPosition = changesList.scrollTop;
    
    // 获取所有任务的变更历史记录
    let allChanges = [];
    
    this.tasks.forEach(task => {
      if (task.changeHistory && task.changeHistory.length > 0) {
        // 获取任务的变更历史记录
        allChanges = [...allChanges, ...task.changeHistory.map(change => ({ 
          ...change, 
          taskId: task.id,
          taskTitle: task.title,
          taskUrl: task.url,
          favicon: task.favicon
        }))];
      }
    });
    
    if (allChanges.length === 0) {
      changesList.innerHTML = `
        <div class="empty-state">
          <p>暂无内容变更</p>
        </div>
      `;
      return;
    }
    
    // 根据变更时间排序，最新的在前面
    allChanges.sort((a, b) => new Date(b.changeTime) - new Date(a.changeTime));
    
    changesList.innerHTML = '';
    
    allChanges.forEach(change => {
      const changeItem = document.createElement('div');
      changeItem.className = 'change-item';
      changeItem.setAttribute('data-change-id', change.id);
      changeItem.setAttribute('data-task-id', change.taskId);
      
      const changeTime = new Date(change.changeTime);
      const formattedTime = changeTime.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      
      // 创建内容部分
      changeItem.innerHTML = `
        <div class="change-header">
          <div class="change-site-info">
            <img src="${change.favicon || 'icons/icon16.png'}" alt="" class="site-favicon" onerror="this.src='icons/icon16.png'">
            <div class="change-title-url">
              <div class="title-with-action">
                <h3><a href="${change.taskUrl}" target="_blank">${change.taskTitle}</a></h3>
                <a href="${change.taskUrl}" target="_blank" class="view-webpage-btn">查看完整页面</a>
              </div>
            </div>
          </div>
          <div class="change-time">
            <span>${formattedTime}</span>
          </div>
        </div>
        <div class="change-content">
          <div class="html-preview">
            ${change.content}
          </div>
        </div>
      `;
      
      // 创建时间指示器
      const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
      const timeIndicator = document.createElement('div');
      timeIndicator.className = 'change-time-indicator';
      timeIndicator.innerHTML = `
        <div class="day">${changeTime.getDate()}</div>
        <div class="month">${monthNames[changeTime.getMonth()].substring(0, 2)}</div>
        <div class="year">${changeTime.getFullYear()}</div>
      `;
      
      // 添加时间指示器到变更项
      changeItem.appendChild(timeIndicator);
      
      changesList.appendChild(changeItem);
    });
    
    // 恢复滚动位置
    changesList.scrollTop = scrollPosition;
  }
  
  filterChanges(filter) {
    const changesList = document.getElementById('changes-list');
    if (!changesList) return;
    
    const changeItems = changesList.querySelectorAll('.change-item');
    
    changeItems.forEach(item => {
      const taskId = item.getAttribute('data-task-id');
      const task = this.tasks.find(t => t.id === taskId);
      
      if (!task || !task.changeHistory || task.changeHistory.length === 0) return;
      
      const changeDate = new Date(task.changeHistory[task.changeHistory.length - 1].changeTime);
      const now = new Date();
      
      if (filter === 'all') {
        item.style.display = '';
      } else if (filter === 'today') {
        // 检查是否是今天
        const isToday = changeDate.toDateString() === now.toDateString();
        item.style.display = isToday ? '' : 'none';
      } else if (filter === 'week') {
        // 检查是否是过去7天
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        item.style.display = changeDate >= oneWeekAgo ? '' : 'none';
      }
    });
  }

  initSettingsSection() {
    // 填充设置表单
    this.fillSettingsForm();
    
    // 初始化设置页面功能
    const saveSettingsBtn = document.getElementById("save-settings-btn");
    if (saveSettingsBtn) {
      saveSettingsBtn.addEventListener("click", () => {
        this.saveSettingsForm();
      });
    }

    const resetSettingsBtn = document.getElementById("reset-settings-btn");
    if (resetSettingsBtn) {
      resetSettingsBtn.addEventListener("click", () => {
        this.resetSettingsForm();
      });
    }
    
    const clearDataBtn = document.getElementById("clear-data-btn");
    if (clearDataBtn) {
      clearDataBtn.addEventListener("click", () => {
        this.confirmClearData();
      });
    }
    
    const exportDataBtn = document.getElementById("export-data-btn");
    if (exportDataBtn) {
      exportDataBtn.addEventListener("click", () => {
        this.exportData();
      });
    }
    
    const importDataBtn = document.getElementById("import-data-btn");
    if (importDataBtn) {
      importDataBtn.addEventListener("click", () => {
        this.importData();
      });
    }
  }
  
  fillSettingsForm() {
    // 通知设置
    const enableNotificationsEl = document.getElementById('enable-notifications');
    if (enableNotificationsEl) {
      enableNotificationsEl.checked = this.settings.enableNotifications;
    }
    
    const notificationSoundEl = document.getElementById('notification-sound');
    if (notificationSoundEl) {
      notificationSoundEl.value = this.settings.notificationSound;
    }
    
    // 监控设置
    const defaultCheckIntervalEl = document.getElementById('default-check-interval');
    if (defaultCheckIntervalEl) {
      defaultCheckIntervalEl.value = this.settings.defaultCheckInterval;
    }
    
    const retryOnErrorEl = document.getElementById('retry-on-error');
    if (retryOnErrorEl) {
      retryOnErrorEl.checked = this.settings.retryOnError;
    }
    
    const maxRetriesEl = document.getElementById('max-retries');
    if (maxRetriesEl) {
      maxRetriesEl.value = this.settings.maxRetries;
    }
    
    // 存储设置
    const maxHistoryEl = document.getElementById('max-history');
    if (maxHistoryEl) {
      maxHistoryEl.value = this.settings.maxHistory;
    }
  }
  
  saveSettingsForm() {
    // 从表单获取设置
    const enableNotifications = document.getElementById('enable-notifications')?.checked;
    const defaultCheckInterval = parseInt(document.getElementById('default-check-interval')?.value || '60');
    const retryOnError = document.getElementById('retry-on-error')?.checked;
    const maxRetries = parseInt(document.getElementById('max-retries')?.value || '3');
    const maxHistory = parseInt(document.getElementById('max-history')?.value || '100');
    
    // 验证数据
    if (defaultCheckInterval < 1) {
      alert('默认检查间隔不能小于1分钟');
      return;
    }
    
    // 更新设置
    this.settings = {
      ...this.settings,
      enableNotifications: enableNotifications ?? this.settings.enableNotifications,
      defaultCheckInterval: defaultCheckInterval || this.settings.defaultCheckInterval,
      retryOnError: retryOnError ?? this.settings.retryOnError,
      maxRetries: maxRetries || this.settings.maxRetries,
      maxHistory: maxHistory || this.settings.maxHistory
    };
    
    // 保存设置
    this.saveSettings().then(() => {
      alert('设置已保存');
    });
  }
  
  resetSettingsForm() {
    if (confirm('确定要恢复默认设置吗？')) {
      this.settings = {
        defaultCheckInterval: 60,
        enableNotifications: true,
        retryOnError: true,
        maxRetries: 3,
        maxHistory: 100
      };
      
      this.saveSettings().then(() => {
        // 重新填充表单
        this.fillSettingsForm();
        alert('已恢复默认设置');
      });
    }
  }
  
  async confirmClearData() {
    const confirmed = await this.confirm({
      title: '确认清除数据',
      content: '确定要清除所有数据吗？此操作将删除所有监控任务和设置，且不可恢复。',
      confirmText: '清除',
      cancelText: '取消'
    });
    
    if (confirmed) {
      // 清除所有任务
      this.tasks.forEach(task => {
        this.cancelTask(task);
      });
      
      this.tasks = [];
      
      // 重置设置
      this.settings = {
        defaultCheckInterval: 60,
        enableNotifications: true,
        retryOnError: true,
        maxRetries: 3,
        maxHistory: 100
      };
      
      // 保存到存储
      await Promise.all([
        this.saveTasks(),
        this.saveSettings()
      ]);
      
      await this.alert('所有数据已清除', '操作成功');
      // 重新加载页面
      window.location.reload();
    }
  }
  
  exportData() {
    const data = {
      tasks: this.tasks,
      settings: this.settings,
      exportDate: new Date().toISOString()
    };
    
    // 创建下载链接
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    
    // 创建临时下载元素
    const a = document.createElement('a');
    a.href = url;
    a.download = `网页内容监控-数据备份-${new Date().toISOString().substring(0, 10)}.json`;
    a.click();
    
    // 清理
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 100);
  }
  
  importData() {
    // 创建文件输入元素
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target.result);
          
          // 验证数据格式
          if (!data.tasks || !Array.isArray(data.tasks)) {
            throw new Error('无效的任务数据');
          }
          
          if (confirm(`确定要导入${data.tasks.length}个任务和设置吗？现有数据将被覆盖。`)) {
            // 取消现有任务的定时器
            this.tasks.forEach(task => {
              this.cancelTask(task);
            });
            
            // 更新数据
            this.tasks = data.tasks;
            
            if (data.settings) {
              this.settings = {...this.settings, ...data.settings};
            }
            
            // 保存数据
            Promise.all([
              this.saveTasks(),
              this.saveSettings()
            ]).then(() => {
              // 为导入的任务重新设置定时器
              this.tasks.forEach(task => {
                if (task.enabled) {
                  this.scheduleTask(task);
                }
              });
              
              alert('数据导入成功');
              // 重新加载页面
              window.location.reload();
            });
          }
        } catch (error) {
          alert(`导入失败: ${error.message}`);
        }
      };
      
      reader.readAsText(file);
    };
    
    input.click();
  }

  showTaskEditForm(taskData = null) {
    const contentContainer = document.getElementById("content-container");
    const template = document.getElementById("task-edit-template");

    if (template) {
      contentContainer.innerHTML = "";
      const content = template.content.cloneNode(true);
      contentContainer.appendChild(content);

      // 如果有任务数据，则填充表单
      if (taskData) {
        const form = document.getElementById('task-form');
        
        if (taskData.id) {
          // 编辑现有任务
          form.setAttribute('data-task-id', taskData.id);
        }
        
        document.getElementById("task-title").value = taskData.title || '';
        document.getElementById("task-url").value = taskData.url || '';
        document.getElementById("selector-value").value = taskData.selector || '';
        document.getElementById("selector-type").value = taskData.selectorType || 'css';
        
        // 更新favicon
        if (taskData.favicon) {
          const faviconImg = document.getElementById("url-favicon-img");
          if (faviconImg) {
            faviconImg.src = taskData.favicon;
          }
          document.getElementById("favicon-url").value = taskData.favicon;
        }
        
        // 如果有XPath选择器，也填充
        if (taskData.xpathSelector) {
          const xpathInput = document.getElementById("xpath-selector-value");
          if (xpathInput) {
            xpathInput.value = taskData.xpathSelector;
          }
        }
        
        // 设置检查间隔
        if (taskData.checkInterval) {
          this.setIntervalFields(taskData.checkInterval);
        }
      }

      this.initTaskForm();
    }
  }
  
  setIntervalFields(totalMinutes) {
    const intervalValue = document.getElementById('interval-value');
    const intervalUnit = document.getElementById('interval-unit');
    
    if (!intervalValue || !intervalUnit) return;
    
    if (totalMinutes < 60) {
      // 分钟
      intervalValue.value = totalMinutes;
      intervalUnit.value = 'minutes';
    } else if (totalMinutes < 1440) {
      // 小时
      intervalValue.value = Math.floor(totalMinutes / 60);
      intervalUnit.value = 'hours';
    } else {
      // 天
      intervalValue.value = Math.floor(totalMinutes / 1440);
      intervalUnit.value = 'days';
    }
  }
  
  getIntervalMinutes() {
    const intervalValue = parseInt(document.getElementById('interval-value').value || '60');
    const intervalUnit = document.getElementById('interval-unit').value;
    
    let minutes = intervalValue;
    
    if (intervalUnit === 'hours') {
      minutes = intervalValue * 60;
    } else if (intervalUnit === 'days') {
      minutes = intervalValue * 1440; // 24小时 * 60分钟
    }
    
    // 确保检查间隔至少为1分钟
    return Math.max(1, minutes);
  }

  initTaskForm() {
    // 表单操作
    document.getElementById("close-task-edit-btn")?.addEventListener("click", () => {
      this.loadContent("tasks");
    });
    
    document.getElementById("cancel-task-btn")?.addEventListener("click", () => {
      this.loadContent("tasks");
    });
    
    document.getElementById("task-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      this.saveTaskForm();
    });
    
    document.getElementById("select-element-btn")?.addEventListener("click", () => {
      this.selectElement();
    });
    
    document.getElementById("test-selector-btn")?.addEventListener("click", () => {
      this.testSelectorFromForm();
    });
    
    // 选择器类型切换
    const selectorType = document.getElementById('selector-type');
    if (selectorType) {
      selectorType.addEventListener('change', () => {
        this.toggleSelectorInputs();
      });
      
      // 初始化显示正确的输入框
      this.toggleSelectorInputs();
    }
    
    // 网址输入监听，更新favicon
    const urlInput = document.getElementById('task-url');
    if (urlInput) {
      urlInput.addEventListener('blur', () => {
        // 如果用户没有手动输入favicon URL，尝试自动生成
        const faviconUrlInput = document.getElementById('favicon-url');
        if (faviconUrlInput && !faviconUrlInput.value.trim()) {
          this.updateUrlFavicon(urlInput.value);
        }
      });
      
      // 如果已有URL，立即更新favicon
      if (urlInput.value) {
        const faviconUrlInput = document.getElementById('favicon-url');
        if (faviconUrlInput && !faviconUrlInput.value.trim()) {
          this.updateUrlFavicon(urlInput.value);
        }
      }
    }
    
    // favicon URL输入监听
    const faviconUrlInput = document.getElementById('favicon-url');
    if (faviconUrlInput) {
      faviconUrlInput.addEventListener('blur', () => {
        const faviconUrl = faviconUrlInput.value.trim();
        if (faviconUrl) {
          const faviconElement = document.getElementById('url-favicon-img');
          if (faviconElement) {
            faviconElement.src = faviconUrl;
            faviconElement.onerror = () => {
              faviconElement.src = 'icons/icon16.png';
            };
          }
        }
      });
    }
  }
  
  toggleSelectorInputs() {
    const selectorType = document.getElementById('selector-type').value;
    const cssInputGroup = document.getElementById('css-selector-group');
    const xpathInputGroup = document.getElementById('xpath-selector-group');
    
    if (selectorType === 'css') {
      cssInputGroup.style.display = '';
      xpathInputGroup.style.display = 'none';
    } else {
      cssInputGroup.style.display = 'none';
      xpathInputGroup.style.display = '';
    }
  }
  
  async saveTaskForm() {
    const form = document.getElementById('task-form');
    const taskId = form.getAttribute('data-task-id');
    
    // 获取表单数据
    const title = document.getElementById('task-title').value.trim();
    const url = document.getElementById('task-url').value.trim();
    const selectorType = document.getElementById('selector-type').value;
    
    // 根据选择器类型获取选择器
    let selector = '';
    let xpathSelector = '';
    
    if (selectorType === 'css') {
      selector = document.getElementById('selector-value').value.trim();
      xpathSelector = document.getElementById('xpath-selector-value')?.value?.trim() || '';
    } else {
      selector = document.getElementById('xpath-selector-value').value.trim();
    }
    
    // 获取检查间隔
    const checkInterval = this.getIntervalMinutes();
    
    // 验证输入
    if (!title) {
      await this.alert('请输入任务标题', '表单验证');
      return;
    }
    
    if (!url) {
      await this.alert('请输入监控网址', '表单验证');
      return;
    }
    
    if (!selector) {
      await this.alert('请输入选择器', '表单验证');
      return;
    }
    
    // 准备任务数据
    const taskData = {
      title,
      url,
      selector,
      selectorType,
      xpathSelector,
      checkInterval
    };
    
    // 获取favicon URL
    const faviconUrl = document.getElementById('favicon-url')?.value.trim();
    if (faviconUrl) {
      taskData.favicon = faviconUrl;
    }
    
    // 如果表单中没有内容，添加当前页面信息作为默认值
    if (!taskData.content) {
      const testResult = document.getElementById('selector-test-result');
      if (testResult && testResult.getAttribute('data-content')) {
        taskData.content = testResult.getAttribute('data-content');
      }
    }
    
    try {
      if (taskId) {
        // 更新现有任务
        await this.updateTask(taskId, taskData);
        await this.alert('任务已更新', '操作成功');
      } else {
        // 创建新任务
        await this.addTask(taskData);
        await this.alert('任务已创建', '操作成功');
      }
      
      // 返回任务列表
      this.loadContent('tasks');
    } catch (error) {
      await this.alert(`保存任务失败: ${error.message}`, '操作失败');
    }
  }
  
  async selectElement() {
    const url = document.getElementById('task-url').value.trim();
    
    if (!url) {
      await this.alert('请先输入要监控的网址', '操作提示');
      return;
    }
    
    // 检查URL是否有效
    try {
      new URL(url);
    } catch (error) {
      await this.alert('请输入有效的网址，包含http://或https://', '格式错误');
      return;
    }
    
    // 打开一个新标签页进入选择模式，使用固定模式
    chrome.tabs.create({url, pinned: true}, (tab) => {
      // 等待页面加载完成
      const listener = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          // 页面加载完成，启动选择模式
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, {action: 'startSelection'});
          }, 500);
          
          chrome.tabs.onUpdated.removeListener(listener);
        }
      };
      
      chrome.tabs.onUpdated.addListener(listener);
    });
  }
  
  async testSelectorFromForm() {
    const url = document.getElementById('task-url').value.trim();
    const selectorType = document.getElementById('selector-type').value;
    
    let selector = '';
    if (selectorType === 'css') {
      selector = document.getElementById('selector-value').value.trim();
    } else {
      selector = document.getElementById('xpath-selector-value').value.trim();
    }
    
    if (!url) {
      alert('请输入要监控的网址');
      return;
    }
    
    if (!selector) {
      alert('请输入选择器');
      return;
    }
    
    const resultDiv = document.getElementById('selector-test-result');
    resultDiv.textContent = '测试中...';
    resultDiv.className = 'selector-test-result';
    resultDiv.style.display = 'block';
    
    try {
      const result = await this.testSelector(url, selector, selectorType);
      
      if (result.success) {
        // 创建内容预览元素
        const contentPreviewHTML = `
          <div class="content-preview-header">选择器测试成功，已提取以下内容：</div>
          <div class="content-preview-container">
            ${result.content}
          </div>
        `;
        
        resultDiv.innerHTML = contentPreviewHTML;
        resultDiv.className = 'selector-test-result success';
        
        // 存储内容以在保存任务时使用
        resultDiv.setAttribute('data-content', result.content);
      } else {
        resultDiv.textContent = `测试失败: ${result.message}`;
        resultDiv.className = 'selector-test-result error';
      }
    } catch (error) {
      resultDiv.textContent = `测试失败: ${error.message}`;
      resultDiv.className = 'selector-test-result error';
    }
  }

  // 更新URL的favicon
  async updateUrlFavicon(url) {
    if (!url || !url.trim()) return;
    
    try {
      // 验证URL格式
      const urlObj = new URL(url);
      
      const faviconElement = document.getElementById('url-favicon-img');
      const faviconUrlInput = document.getElementById('favicon-url');
      if (!faviconElement || !faviconUrlInput) return;
      
      // 尝试从页面获取favicon
      try {
        // 发送消息给后台脚本，获取页面favicon链接
        chrome.runtime.sendMessage({
          action: 'getFavicon',
          url: url
        }, (response) => {
          if (response && response.success && response.faviconUrl) {
            // 如果成功获取到favicon
            const absoluteFaviconUrl = new URL(response.faviconUrl, urlObj.origin).href;
            // 设置favicon图像
            faviconElement.src = absoluteFaviconUrl;
            // 同时更新favicon URL输入框
            faviconUrlInput.value = absoluteFaviconUrl;
            
            // 设置onerror处理，如果加载失败则使用默认图标
            faviconElement.onerror = () => {
              // 尝试使用根目录的favicon.ico作为备选
              const rootFaviconUrl = `${urlObj.origin}/favicon.ico`;
              faviconElement.src = rootFaviconUrl;
              faviconUrlInput.value = rootFaviconUrl;
              
              // 如果根目录favicon也无法加载，使用默认图标
              faviconElement.onerror = () => {
                faviconElement.src = 'icons/icon16.png';
                faviconUrlInput.value = ''; // 清空输入框
              };
            };
            return;
          } else {
            // 如果无法从页面获取favicon，使用根目录的favicon.ico作为备选
            const rootFaviconUrl = `${urlObj.origin}/favicon.ico`;
            faviconElement.src = rootFaviconUrl;
            faviconUrlInput.value = rootFaviconUrl;
            
            // 设置onerror处理，如果加载失败则使用默认图标
            faviconElement.onerror = () => {
              faviconElement.src = 'icons/icon16.png';
              faviconUrlInput.value = ''; // 清空输入框
            };
          }
        });
      } catch (error) {
        console.error('获取页面favicon失败:', error);
        // 使用网站根目录的favicon.ico作为备选
        const rootFaviconUrl = `${urlObj.origin}/favicon.ico`;
        faviconElement.src = rootFaviconUrl;
        faviconUrlInput.value = rootFaviconUrl;
        
        // 设置onerror处理，如果加载失败则使用默认图标
        faviconElement.onerror = () => {
          faviconElement.src = 'icons/icon16.png';
          faviconUrlInput.value = ''; // 清空输入框
        };
      }
    } catch (error) {
      console.error('无效的URL格式:', error);
    }
  }

  // 显示统一样式的弹窗
  showModal(options) {
    const { title, content, buttons, width } = options;
    
    // 移除已有的弹窗
    const existingModal = document.querySelector('.app-modal-overlay');
    if (existingModal) {
      document.body.removeChild(existingModal);
    }
    
    // 创建弹窗覆盖层
    const overlay = document.createElement('div');
    overlay.className = 'app-modal-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.style.zIndex = '9999';
    
    // 创建弹窗内容
    const modal = document.createElement('div');
    modal.className = 'app-modal';
    modal.style.backgroundColor = '#fff';
    modal.style.borderRadius = '4px';
    modal.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2)';
    modal.style.maxWidth = '90%';
    modal.style.width = width || '400px';
    modal.style.maxHeight = '90vh';
    modal.style.overflow = 'auto';
    modal.style.position = 'relative';
    
    // 创建弹窗头部
    const modalHeader = document.createElement('div');
    modalHeader.className = 'app-modal-header';
    modalHeader.style.padding = '16px';
    modalHeader.style.borderBottom = '1px solid #e0e0e0';
    modalHeader.style.display = 'flex';
    modalHeader.style.justifyContent = 'space-between';
    modalHeader.style.alignItems = 'center';
    
    const modalTitle = document.createElement('h3');
    modalTitle.style.margin = '0';
    modalTitle.style.fontSize = '18px';
    modalTitle.style.fontWeight = '500';
    modalTitle.textContent = title || '系统消息';
    
    const closeBtn = document.createElement('button');
    closeBtn.style.background = 'none';
    closeBtn.style.border = 'none';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontSize = '22px';
    closeBtn.style.color = '#666';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => {
      document.body.removeChild(overlay);
    });
    
    modalHeader.appendChild(modalTitle);
    modalHeader.appendChild(closeBtn);
    
    // 创建弹窗内容区域
    const modalContent = document.createElement('div');
    modalContent.className = 'app-modal-content';
    modalContent.style.padding = '16px';
    
    if (typeof content === 'string') {
      modalContent.innerHTML = content;
    } else if (content instanceof HTMLElement) {
      modalContent.appendChild(content);
    }
    
    // 创建弹窗底部按钮区域
    const modalFooter = document.createElement('div');
    modalFooter.className = 'app-modal-footer';
    modalFooter.style.padding = '16px';
    modalFooter.style.borderTop = '1px solid #e0e0e0';
    modalFooter.style.display = 'flex';
    modalFooter.style.justifyContent = 'flex-end';
    modalFooter.style.gap = '8px';
    
    if (buttons && buttons.length) {
      buttons.forEach(btn => {
        const button = document.createElement('button');
        button.textContent = btn.text;
        button.className = `btn ${btn.primary ? 'btn-primary' : 'btn-secondary'}`;
        
        if (btn.onClick) {
          button.addEventListener('click', () => {
            btn.onClick();
            document.body.removeChild(overlay);
          });
        } else {
          button.addEventListener('click', () => {
            document.body.removeChild(overlay);
          });
        }
        
        modalFooter.appendChild(button);
      });
    } else {
      // 默认添加一个确定按钮
      const okButton = document.createElement('button');
      okButton.textContent = '确定';
      okButton.className = 'btn btn-primary';
      okButton.addEventListener('click', () => {
        document.body.removeChild(overlay);
      });
      modalFooter.appendChild(okButton);
    }
    
    // 组装弹窗
    modal.appendChild(modalHeader);
    modal.appendChild(modalContent);
    modal.appendChild(modalFooter);
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    return {
      close: () => {
        if (document.body.contains(overlay)) {
          document.body.removeChild(overlay);
        }
      }
    };
  }
  
  // 确认对话框
  confirm(options) {
    return new Promise((resolve) => {
      const buttons = [
        {
          text: options.cancelText || '取消',
          primary: false,
          onClick: () => resolve(false)
        },
        {
          text: options.confirmText || '确定',
          primary: true,
          onClick: () => resolve(true)
        }
      ];
      
      this.showModal({
        title: options.title || '确认操作',
        content: options.content || '是否确认执行此操作？',
        buttons: buttons,
        width: options.width
      });
    });
  }
  
  // 提示信息
  async alert(message, title = '系统提示') {
    return new Promise((resolve) => {
      this.showModal({
        title: title,
        content: message,
        buttons: [
          {
            text: '确定',
            primary: true,
            onClick: () => resolve()
          }
        ]
      });
    });
  }

  // 确认清空变更
  async confirmClearChanges() {
    const result = await this.confirm({
      title: '确认操作',
      message: '确定要清空所有变更记录吗？此操作不可撤销。',
      confirmText: '确定清空',
      cancelText: '取消'
    });
    
    if (result) {
      await this.clearAllChanges();
    }
  }
  
  // 清空所有变更记录
  async clearAllChanges() {
    this.showLoading('正在清空变更记录...');
    
    // 清空所有任务的变更历史
    const updatedTasks = this.tasks.map(task => {
      const updatedTask = {...task};
      updatedTask.changeHistory = [];
      return updatedTask;
    });
    
    // 更新存储
    this.tasks = updatedTasks;
    await this.saveTasks();
    
    // 刷新变更列表
    this.loadChangesList();
    this.hideLoading();
    
    await this.showMessage('所有变更记录已清空', 'success');
  }

  // 手动检测任务
  async manualCheckTask(taskId) {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return;
    
    try {
      // 显示检测中的提示
      const preview = this.showContentPreview('', true, '检测中，请稍候...');
      
      // 通过后台脚本检测内容
      const result = await this.testSelector(task.url, task.selector, task.selectorType);
      
      if (!result.success) {
        // 更新提示为错误信息
        preview.update(`检测失败: ${result.message}`, false, '操作失败');
        return;
      }
      
      // 比较内容是否有变化
      const hasChanged = task.currentContent !== result.content;
      
      // 更新任务
      const updatedTask = {
        ...task,
        lastCheck: new Date().toISOString()
      };
      
      if (hasChanged) {
        const changeTime = new Date().toISOString();
        updatedTask.currentContent = result.content;
        
        // 添加到变更历史
        if (!updatedTask.changeHistory) {
          updatedTask.changeHistory = [];
        }
        
        // 创建变更记录
        updatedTask.changeHistory.push({
          id: `change_${taskId}_${Date.now()}`,
          content: result.content,
          changeTime: changeTime
        });
        
        // 限制历史记录数量
        const maxHistory = this.settings.maxHistory || 100;
        if (updatedTask.changeHistory.length > maxHistory) {
          updatedTask.changeHistory = updatedTask.changeHistory.slice(-maxHistory);
        }
      }
      
      // 保存更新后的任务
      await this.updateTask(taskId, updatedTask);
      
      // 更新提示内容
      const statusText = hasChanged ? '检测完成，内容已变更' : '检测完成，内容未变更';
      preview.update(result.content, false, statusText);
      
      // 刷新相关列表
      if (hasChanged) {
        // 如果在任务页面，刷新任务列表
        if (document.querySelector('.tasks-section')) {
          this.loadTasksList();
        }
        
        // 如果变更页面已打开，刷新变更列表
        if (document.querySelector('.changes-section')) {
          this.loadChangesList();
        }
      }
    } catch (error) {
      console.error('手动检测失败:', error);
      // 显示错误提示
      this.showContentPreview(`检测失败: ${error.message}`, false, '操作失败');
    }
  }

  // 显示内容预览弹窗
  showContentPreview(content, isLoading = false, statusText = '') {
    // 创建内容预览层
    const previewOverlay = document.createElement('div');
    previewOverlay.style.position = 'fixed';
    previewOverlay.style.top = '20px';
    previewOverlay.style.right = '20px';
    previewOverlay.style.maxWidth = '400px';
    previewOverlay.style.maxHeight = '300px';
    previewOverlay.style.overflow = 'auto';
    previewOverlay.style.backgroundColor = 'white';
    previewOverlay.style.padding = '15px';
    previewOverlay.style.borderRadius = '8px';
    previewOverlay.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2)';
    previewOverlay.style.zIndex = '10001';
    
    // 创建标题栏
    const titleBar = document.createElement('div');
    titleBar.style.display = 'flex';
    titleBar.style.justifyContent = 'space-between';
    titleBar.style.alignItems = 'center';
    titleBar.style.marginBottom = '10px';
    
    // 创建标题
    const title = document.createElement('div');
    title.style.fontWeight = 'bold';
    title.style.fontSize = '14px';
    
    // 根据状态设置标题颜色和文本
    if (isLoading) {
      title.style.color = 'var(--info-color)';
      title.textContent = statusText || '检测中，请稍候...';
    } else if (statusText.includes('失败')) {
      title.style.color = 'var(--danger-color)';
      title.textContent = statusText || '检测失败';
    } else if (statusText.includes('已变更') || statusText.includes('已开启') || statusText.includes('已关闭')) {
      title.style.color = 'var(--success-color)';
      title.textContent = statusText || '操作成功';
    } else {
      title.style.color = 'var(--info-color)';
      title.textContent = statusText || '检测完成，内容未变更';
    }
    
    // 创建关闭按钮
    const closeButton = document.createElement('button');
    closeButton.innerHTML = '&times;';
    closeButton.style.background = 'none';
    closeButton.style.border = 'none';
    closeButton.style.fontSize = '18px';
    closeButton.style.cursor = 'pointer';
    closeButton.style.color = '#555';
    closeButton.addEventListener('click', () => {
      document.body.removeChild(previewOverlay);
    });
    
    titleBar.appendChild(title);
    titleBar.appendChild(closeButton);
    previewOverlay.appendChild(titleBar);
    
    // 创建内容容器
    const contentContainer = document.createElement('div');
    contentContainer.style.maxHeight = '250px';
    contentContainer.style.overflow = 'auto';
    contentContainer.style.border = '1px solid #eee';
    contentContainer.style.padding = '10px';
    contentContainer.style.borderRadius = '4px';
    contentContainer.style.fontSize = '13px';
    contentContainer.style.backgroundColor = '#f9f9f9';
    
    if (isLoading) {
      // 添加加载动画
      const loadingContainer = document.createElement('div');
      loadingContainer.style.display = 'flex';
      loadingContainer.style.alignItems = 'center';
      loadingContainer.style.justifyContent = 'center';
      loadingContainer.style.flexDirection = 'column';
      loadingContainer.style.padding = '20px';
      
      // 创建旋转加载图标
      const spinner = document.createElement('div');
      spinner.style.border = '3px solid #f3f3f3';
      spinner.style.borderTop = '3px solid var(--primary-color)';
      spinner.style.borderRadius = '50%';
      spinner.style.width = '24px';
      spinner.style.height = '24px';
      spinner.style.animation = 'spin 1s linear infinite';
      spinner.style.marginBottom = '10px';
      
      // 添加加载文本
      const loadingText = document.createElement('div');
      loadingText.textContent = '正在检测网页内容...';
      
      loadingContainer.appendChild(spinner);
      loadingContainer.appendChild(loadingText);
      contentContainer.appendChild(loadingContainer);
    } else {
      // 显示提取的内容
      contentContainer.innerHTML = content;
    }
    
    previewOverlay.appendChild(contentContainer);
    
    // 添加到页面
    document.body.appendChild(previewOverlay);
    
    // 自动关闭提示的时间（毫秒）
    const autoCloseTime = 3000; // 3秒后自动关闭
    
    // 如果不是加载状态，自动关闭
    if (!isLoading) {
      setTimeout(() => {
        if (document.body.contains(previewOverlay)) {
          document.body.removeChild(previewOverlay);
        }
      }, autoCloseTime);
    }
    
    // 返回对象，以便外部控制
    return {
      close: () => {
        if (document.body.contains(previewOverlay)) {
          document.body.removeChild(previewOverlay);
        }
      },
      update: (newContent, stillLoading = false, newStatusText = '') => {
        // 更新标题
        const titleElement = previewOverlay.querySelector('div > div');
        if (titleElement) {
          // 根据状态设置标题颜色和文本
          if (stillLoading) {
            titleElement.style.color = 'var(--info-color)';
            titleElement.textContent = newStatusText || '检测中，请稍候...';
          } else if (newStatusText.includes('失败')) {
            titleElement.style.color = 'var(--danger-color)';
            titleElement.textContent = newStatusText || '检测失败';
          } else if (newStatusText.includes('已变更') || newStatusText.includes('已开启') || newStatusText.includes('已关闭')) {
            titleElement.style.color = 'var(--success-color)';
            titleElement.textContent = newStatusText || '操作成功';
          } else {
            titleElement.style.color = 'var(--info-color)';
            titleElement.textContent = newStatusText || '检测完成，内容未变更';
          }
        }
        
        // 更新内容
        const contentElement = previewOverlay.querySelector('div:nth-child(2)');
        if (contentElement) {
          if (stillLoading) {
            // 保持加载动画
          } else {
            contentElement.innerHTML = newContent;
            
            // 设置自动关闭定时器
            setTimeout(() => {
              if (document.body.contains(previewOverlay)) {
                document.body.removeChild(previewOverlay);
              }
            }, autoCloseTime);
          }
        }
      }
    };
  }

  // 添加显示消息的方法
  async showMessage(message, type = 'info', duration = 1500) {
    // 创建消息元素
    const toast = document.createElement('div');
    toast.className = `app-toast toast-${type}`;
    toast.textContent = message;
    
    // 样式设置
    toast.style.position = 'fixed';
    toast.style.top = '20px'; // 改为顶部
    toast.style.right = '20px'; // 改为右侧
    toast.style.transform = 'none'; // 移除水平居中变换
    toast.style.padding = '10px 20px';
    toast.style.borderRadius = '4px';
    toast.style.color = '#fff';
    toast.style.fontSize = '14px';
    toast.style.zIndex = '10000';
    toast.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2)';
    toast.style.maxWidth = '300px'; // 限制最大宽度
    toast.style.wordWrap = 'break-word'; // 确保长消息能够换行
    
    // 根据类型设置背景颜色
    if (type === 'success') {
      toast.style.backgroundColor = 'var(--success-color)';
    } else if (type === 'error') {
      toast.style.backgroundColor = 'var(--danger-color)';
    } else if (type === 'warning') {
      toast.style.backgroundColor = 'var(--warning-color)';
    } else {
      toast.style.backgroundColor = 'var(--info-color)';
    }
    
    // 添加到页面
    document.body.appendChild(toast);
    
    // 自动消失
    if (duration > 0) {
      setTimeout(() => {
        if (document.body.contains(toast)) {
          document.body.removeChild(toast);
        }
      }, duration);
    }
    
    return {
      remove: () => {
        if (document.body.contains(toast)) {
          document.body.removeChild(toast);
        }
      }
    };
  }
  
  // 添加加载状态显示
  showLoading(message = '加载中...') {
    // 创建加载元素
    const loading = document.createElement('div');
    loading.id = 'app-loading';
    loading.style.position = 'fixed';
    loading.style.top = '0';
    loading.style.left = '0';
    loading.style.width = '100%';
    loading.style.height = '100%';
    loading.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
    loading.style.display = 'flex';
    loading.style.justifyContent = 'center';
    loading.style.alignItems = 'center';
    loading.style.zIndex = '10001';
    
    const loadingContent = document.createElement('div');
    loadingContent.style.backgroundColor = '#fff';
    loadingContent.style.padding = '20px 30px';
    loadingContent.style.borderRadius = '4px';
    loadingContent.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2)';
    loadingContent.style.textAlign = 'center';
    
    const spinner = document.createElement('div');
    spinner.className = 'loading-spinner';
    spinner.style.border = '3px solid #f3f3f3';
    spinner.style.borderTop = '3px solid var(--primary-color)';
    spinner.style.borderRadius = '50%';
    spinner.style.width = '24px';
    spinner.style.height = '24px';
    spinner.style.animation = 'spin 1s linear infinite';
    spinner.style.margin = '0 auto 10px';
    
    // 添加动画样式
    const style = document.createElement('style');
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
    
    const text = document.createElement('div');
    text.textContent = message;
    
    loadingContent.appendChild(spinner);
    loadingContent.appendChild(text);
    loading.appendChild(loadingContent);
    
    document.body.appendChild(loading);
  }
  
  // 隐藏加载状态
  hideLoading() {
    const loading = document.getElementById('app-loading');
    if (loading) {
      document.body.removeChild(loading);
    }
  }
}

// 当DOM加载完成时初始化应用
document.addEventListener("DOMContentLoaded", () => {
  window.app = new WebMonitorApp();
}); 