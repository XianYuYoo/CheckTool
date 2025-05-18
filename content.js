// 全局变量
let isSelecting = false;
let selectedElement = null;
let highlightOverlay = null;
let selectedHighlightOverlay = null;
let selectorPanel = null;
let confirmDialog = null;
let domInspector = null;
let contentToastOverlay = null; // 新增：用于显示提取内容的toast

// 处理来自background.js的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Content脚本收到消息:', message);
  
  if (message.action === 'startSelection') {
    startElementSelection(sendResponse);
    return true; // 异步响应
  }
  
  else if (message.action === 'stopSelection') {
    stopElementSelection();
    sendResponse({success: true});
  }
  
  else if (message.action === 'extractContent') {
    try {
      let element;
      let content = '';
      
      // 根据选择器类型选择元素
      if (message.selectorType === 'xpath') {
        try {
          const result = document.evaluate(
            message.selector,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
          );
          
          element = result.singleNodeValue;
        } catch (xpathError) {
          console.error('XPath解析错误:', xpathError);
          sendResponse({
            error: `XPath选择器错误: ${xpathError.message}`
          });
          return;
        }
      } else {
        // 默认使用CSS选择器
        try {
          element = document.querySelector(message.selector);
        } catch (cssError) {
          console.error('CSS选择器错误:', cssError);
          sendResponse({
            error: `CSS选择器错误: ${cssError.message}`
          });
          return;
        }
      }
      
      if (!element) {
        sendResponse({
          error: '未找到匹配的元素'
        });
        return;
      }
      
      // 获取匹配元素的HTML内容
      content = element.innerHTML;
      
      // 确保在连接关闭前发送响应
      try {
        sendResponse({
          content
        });
      } catch (responseError) {
        console.error('发送响应失败:', responseError);
      }
      
      return true;
    } catch (error) {
      try {
        sendResponse({
          error: `内容提取失败: ${error.message}`
        });
      } catch (responseError) {
        console.error('发送错误响应失败:', responseError);
      }
    }
  }
  
  else if (message.action === 'testSelector') {
    const { selector, selectorType } = message;
    
    // 先显示"检测中"的状态
    const toast = showExtractedContent('', true);
    
    try {
      let element;
      if (selectorType === 'xpath') {
        const result = document.evaluate(
          selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
        );
        element = result.singleNodeValue;
      } else {
        element = document.querySelector(selector);
      }
      
      if (!element) {
        toast.update('未找到匹配元素', false);
        try {
          sendResponse({
            success: false,
            message: '未找到匹配元素'
          });
        } catch (error) {
          console.error('发送响应失败:', error);
        }
        return;
      }
      
      // 简单高亮元素以显示测试结果
      const originalBackground = element.style.background;
      const originalOutline = element.style.outline;
      
      element.style.background = 'rgba(255, 255, 0, 0.3)';
      element.style.outline = '2px solid red';
      
      // 滚动到元素位置
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      setTimeout(() => {
        element.style.background = originalBackground;
        element.style.outline = originalOutline;
      }, 2000);
      
      // 检测完成，更新提示内容
      toast.update(element.innerHTML, false);
      
      try {
        sendResponse({
          success: true,
          content: element.innerHTML
        });
      } catch (error) {
        console.error('发送响应失败:', error);
      }
    } catch (error) {
      // 检测出错，更新提示内容
      toast.update(`选择器测试失败: ${error.message}`, false);
      
      try {
        sendResponse({
          success: false,
          message: `选择器测试失败: ${error.message}`
        });
      } catch (responseError) {
        console.error('发送错误响应失败:', responseError);
      }
    }
    
    return true; // 异步响应
  }
  
  // 添加处理updateContent消息的处理程序
  else if (message.action === 'updateContent') {
    try {
      console.log('收到更新内容:', message.data);
      // 这里处理数据更新逻辑
      
      // 成功后发送响应
      sendResponse({ success: true });
    } catch (error) {
      console.error('处理更新内容失败:', error);
      try {
        sendResponse({ success: false, error: error.message });
      } catch (responseError) {
        console.error('发送错误响应失败:', responseError);
      }
    }
    return true; // 异步响应
  }
});

// 启动元素选择模式
function startElementSelection(callback) {
  if (isSelecting) return;
  
  isSelecting = true;
  selectedElement = null;
  
  // 创建高亮覆盖层
  createHighlightOverlay();
  
  // 创建选择器控制面板
  createSelectorPanel();
  
  // 初始化DomInspector
  domInspector = new DomInspector({
    onClick: function(selector, element) {
      // 当用户点击元素时
      selectedElement = element;
      
      // 创建已选择元素的高亮显示
      createSelectedHighlightOverlay(element);
      
      // 更新选择器面板信息
      updateSelectorPanelInfo(element, true);
      
      // 启用确认按钮
      const confirmButton = document.getElementById('confirm-element-btn');
      if (confirmButton) {
        confirmButton.disabled = false;
        confirmButton.style.opacity = '1';
      }
    }
  });
  
  // 启用DomInspector
  domInspector.enable();
  
  // 添加点击和鼠标移动事件监听器
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('click', handleMouseClick);
  document.addEventListener('keydown', handleKeyDown);
  
  // 修改鼠标指针样式
  document.body.style.cursor = 'crosshair';
  
  // 存储回调函数
  window.selectionCallback = callback;
}

// 停止元素选择模式
function stopElementSelection() {
  if (!isSelecting) return;
  
  isSelecting = false;
  
  // 禁用DomInspector
  if (domInspector) {
    domInspector.disable();
    domInspector = null;
  }
  
  // 移除事件监听器
  document.removeEventListener('mousemove', handleMouseMove);
  document.removeEventListener('click', handleMouseClick);
  document.removeEventListener('keydown', handleKeyDown);
  
  // 恢复鼠标指针样式
  document.body.style.cursor = '';
  
  // 移除高亮覆盖层
  if (highlightOverlay) {
    document.body.removeChild(highlightOverlay);
    highlightOverlay = null;
  }
  
  // 移除已选择元素高亮
  if (selectedHighlightOverlay) {
    document.body.removeChild(selectedHighlightOverlay);
    selectedHighlightOverlay = null;
  }
  
  // 移除选择器控制面板
  if (selectorPanel) {
    document.body.removeChild(selectorPanel);
    selectorPanel = null;
  }
  
  // 移除确认对话框
  if (confirmDialog) {
    document.body.removeChild(confirmDialog);
    confirmDialog = null;
  }
  
  // 重置选择状态
  selectedElement = null;
}

// 处理鼠标移动事件
function handleMouseMove(event) {
  if (!isSelecting) return;
  
  // 阻止事件冒泡
  event.stopPropagation();
  
  // 获取鼠标下的元素
  const targetElement = document.elementFromPoint(event.clientX, event.clientY);
  
  // 如果没有找到元素或者元素是选择器面板的一部分，则忽略
  if (!targetElement || targetElement.closest('#selector-panel')) {
    return;
  }
  
  // 更新高亮覆盖层
  highlightElement(targetElement);
  
  // 不再更新选择器面板信息，只在用户点击选择元素时才更新
  // updateSelectorPanelInfo(targetElement);
}

// 处理鼠标点击事件
function handleMouseClick(event) {
  if (!isSelecting) return;
  
  // 阻止默认事件和冒泡
  event.preventDefault();
  event.stopPropagation();
  
  // 获取点击的元素
  const targetElement = document.elementFromPoint(event.clientX, event.clientY);
  
  // 如果点击的是确认按钮，则确认选择
  if (targetElement && targetElement.id === 'confirm-element-btn') {
    handleSelectionConfirm(selectedElement);
    return;
  }
  
  // 如果点击的是面板或其子元素，则忽略
  if (targetElement && targetElement.closest('#selector-panel')) {
    return;
  }
  
  // 设置当前选中的元素
  selectedElement = targetElement;
  
  // 显示已选中元素的高亮
  createSelectedHighlightOverlay(selectedElement);
  
  // 更新选择器面板信息，这里传入true表示这是选中的元素
  updateSelectorPanelInfo(selectedElement, true);
  
  // 启用确认按钮
  const confirmButton = document.getElementById('confirm-element-btn');
  if (confirmButton) {
    confirmButton.disabled = false;
    confirmButton.style.opacity = '1';
  }
}

// 处理键盘事件
function handleKeyDown(event) {
  if (!isSelecting) return;
  
  // Escape 键取消选择
  if (event.key === 'Escape') {
    stopElementSelection();
    
    // 通知用户选择已取消
    if (window.selectionCallback) {
      window.selectionCallback({
        cancelled: true
      });
      window.selectionCallback = null;
    }
    return;
  }
  
  // 如果是任何其他键，但是点击了选择器面板内的元素，不处理键盘导航
  if (event.target && selectorPanel && selectorPanel.contains(event.target)) {
    return;
  }
  
  // 方向键导航
  let navigatedElement = null;
  
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    
    // 从当前选择的元素或悬停元素开始导航
    const startElement = selectedElement || document.elementFromPoint(
      lastMousePosition.x, 
      lastMousePosition.y
    );
    
    if (startElement && startElement.parentElement) {
      navigatedElement = startElement.parentElement;
    }
  } 
  else if (event.key === 'ArrowDown') {
    event.preventDefault();
    
    // 从当前选择的元素或悬停元素开始导航
    const startElement = selectedElement || document.elementFromPoint(
      lastMousePosition.x, 
      lastMousePosition.y
    );
    
    if (startElement && startElement.children.length > 0) {
      navigatedElement = startElement.children[0];
    }
  }
  else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    
    // 从当前选择的元素或悬停元素开始导航
    const startElement = selectedElement || document.elementFromPoint(
      lastMousePosition.x, 
      lastMousePosition.y
    );
    
    if (startElement && startElement.previousElementSibling) {
      navigatedElement = startElement.previousElementSibling;
    }
  }
  else if (event.key === 'ArrowRight') {
    event.preventDefault();
    
    // 从当前选择的元素或悬停元素开始导航
    const startElement = selectedElement || document.elementFromPoint(
      lastMousePosition.x, 
      lastMousePosition.y
    );
    
    if (startElement && startElement.nextElementSibling) {
      navigatedElement = startElement.nextElementSibling;
    }
  }
  
  // 如果找到了要导航到的元素，更新当前选择
  if (navigatedElement) {
    // 更新当前选择的元素
    selectedElement = navigatedElement;
    
    // 创建已选择元素的高亮显示
    createSelectedHighlightOverlay(navigatedElement);
    
    // 更新悬停高亮
    highlightElement(navigatedElement);
    
    // 更新选择器面板信息
    updateSelectorPanelInfo(navigatedElement, true);
    
    // 启用确认按钮
    const confirmButton = document.getElementById('confirm-element-btn');
    if (confirmButton) {
      confirmButton.disabled = false;
      confirmButton.style.opacity = '1';
    }
  }
  
  // Enter键确认当前选择
  if (event.key === 'Enter' && selectedElement) {
    event.preventDefault();
    
    // 直接处理选择确认
    handleSelectionConfirm(selectedElement);
  }
}

// 定义一个变量来存储最后的鼠标位置
let lastMousePosition = { x: 0, y: 0 };

// 创建高亮覆盖层
function createHighlightOverlay() {
  if (highlightOverlay) return;
  
  highlightOverlay = document.createElement('div');
  highlightOverlay.style.position = 'fixed';
  highlightOverlay.style.pointerEvents = 'none';
  highlightOverlay.style.boxSizing = 'border-box';
  highlightOverlay.style.zIndex = '2147483646'; // 保持低于选中元素高亮的z-index和面板的z-index
  highlightOverlay.style.background = 'rgba(74, 108, 247, 0.2)';
  highlightOverlay.style.border = '2px solid rgba(74, 108, 247, 0.8)';
  
  document.body.appendChild(highlightOverlay);
}

// 高亮显示元素
function highlightElement(element) {
  if (!highlightOverlay || !element) return;
  
  const rect = element.getBoundingClientRect();
  
  highlightOverlay.style.top = `${rect.top}px`;
  highlightOverlay.style.left = `${rect.left}px`;
  highlightOverlay.style.width = `${rect.width}px`;
  highlightOverlay.style.height = `${rect.height}px`;
  
  // 记录最后的鼠标位置
  lastMousePosition = { 
    x: rect.left + (rect.width / 2),
    y: rect.top + (rect.height / 2)
  };
}

// 更新选择器面板信息
function updateSelectorPanelInfo(element, isSelected = false) {
  if (!selectorPanel) return;
  
  // 如果不是选中的元素且不是强制显示，则不更新面板信息
  if (!isSelected) {
    return;
  }
  
  const selectionInfo = document.getElementById('selection-info');
  const selectorInfo = document.getElementById('selector-info');
  
  if (!element) {
    if (selectionInfo) {
      selectionInfo.innerHTML = '<div style="color: #666;">未选择元素</div>';
    }
    if (selectorInfo) {
      selectorInfo.innerHTML = '<div style="color: #666;">未生成选择器</div>';
    }
    return;
  }
  
  if (selectionInfo) {
    // 生成元素信息
    const tagName = element.tagName.toLowerCase();
    const classes = element.className ? Array.from(element.classList).join(' ') : '';
    const id = element.id ? element.id : '';
    
    // 获取文本内容
    let textContent = element.textContent.trim();
    textContent = textContent.length > 50 ? textContent.substring(0, 50) + '...' : textContent;
    
    let html = `
      <div style="font-weight: bold; margin-bottom: 5px;">
        已选择元素:
      </div>
      <div style="margin-bottom: 5px;">
        <span style="color: #6c757d;">类型:</span> &lt;${tagName}&gt;
      </div>
    `;
    
    if (id) {
      html += `<div style="margin-bottom: 5px;"><span style="color: #6c757d;">ID:</span> ${id}</div>`;
    }
    
    if (classes) {
      html += `<div style="margin-bottom: 5px;"><span style="color: #6c757d;">类名:</span> ${classes}</div>`;
    }
    
    html += `<div style="color: #6c757d;">内容预览:</div>
             <div style="font-size: 12px; color: #212529; margin-top: 3px; background: #fff; padding: 4px; border: 1px solid #eee; border-radius: 2px; max-height: 60px; overflow: hidden;">${textContent}</div>`;
    
    selectionInfo.innerHTML = html;
  }
  
  if (selectorInfo && element) {
    // 生成选择器
    const cssSelector = generateCssSelector(element);
    const xpathSelector = generateXPathSelector(element);
    
    let html = `
      <div style="margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
          <span style="color: #6c757d; font-weight: bold;">CSS选择器:</span>
        </div>
        <div style="user-select: all; background: #fff; padding: 6px; border: 1px solid #ddd; border-radius: 4px; margin-top: 3px; word-break: break-all; white-space: normal; font-size: 11px; line-height: 1.5; max-height: none; overflow: visible;">${cssSelector}</div>
      </div>
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
          <span style="color: #6c757d; font-weight: bold;">XPath选择器:</span>
        </div>
        <div style="user-select: all; background: #fff; padding: 6px; border: 1px solid #ddd; border-radius: 4px; margin-top: 3px; word-break: break-all; white-space: normal; font-size: 11px; line-height: 1.5; max-height: none; overflow: visible;">${xpathSelector}</div>
      </div>
    `;
    
    selectorInfo.innerHTML = html;
  }
}

// 生成CSS选择器（结合DOM Inspector的逻辑和优化）
function generateCssSelector(element) {
  // 优先尝试使用DOM Inspector结果（通过重用DomInspector内置高亮时生成的选择器）
  try {
    // 检查是否有全局选择器映射缓存（由DomInspector点击事件产生）
    if (window._lastGeneratedSelector && document.querySelectorAll(window._lastGeneratedSelector).length === 1) {
      const selectedElements = document.querySelectorAll(window._lastGeneratedSelector);
      // 验证选择器是否指向当前元素
      if (selectedElements[0] === element) {
        return window._lastGeneratedSelector;
      }
    }
  } catch (e) {
    console.log('缓存选择器检查失败', e);
  }
  
  // 如果没有缓存选择器或验证失败，使用以下算法生成

  // 创建多个候选选择器，按稳定性排序
  const selectors = [];
  
  // 1. 基于ID的选择器（最稳定）
  if (element.id) {
    const idSelector = `#${CSS.escape(element.id)}`;
    if (isUniqueSelector(idSelector, element)) {
      return idSelector;
    }
    
    const tagWithIdSelector = `${element.tagName.toLowerCase()}#${CSS.escape(element.id)}`;
    if (isUniqueSelector(tagWithIdSelector, element)) {
      return tagWithIdSelector;
    }
    
    selectors.push(idSelector);
  }

  // 2. 生成基于DOM结构的选择器（稳定性较高，优先级提升）
  const structuralSelector = generateStructuralSelector(element);
  if (structuralSelector && isUniqueSelector(structuralSelector, element)) {
    return structuralSelector;
  }
  if (structuralSelector) {
    selectors.push(structuralSelector);
  }
  
  // 3. 如果前面的结构选择器不唯一，构建非常精确的路径选择器（较稳定但复杂）
  const pathSelector = buildPrecisePathSelector(element);
  if (pathSelector && isUniqueSelector(pathSelector, element)) {
    return pathSelector;
  }
  if (pathSelector) {
    selectors.push(pathSelector);
  }
  
  // 4. 使用父级ID加相对路径的选择器（较稳定）
  const parentBasedSelector = generateParentBasedSelector(element);
  if (parentBasedSelector && isUniqueSelector(parentBasedSelector, element)) {
    return parentBasedSelector;
  }
  if (parentBasedSelector) {
    selectors.push(parentBasedSelector);
  }
  
  // 5. 尝试基于数据属性的选择器（较稳定）
  const dataAttributes = [
    'data-index', 'data-id', 'data-testid', 'data-test', 'data-key', 
    'data-item-id', 'data-element-id', 'data-tab', 'data-section'
  ];
  
  for (const attr of dataAttributes) {
    if (element.hasAttribute(attr)) {
      const value = element.getAttribute(attr);
      const dataSelector = `${element.tagName.toLowerCase()}[${attr}="${CSS.escape(value)}"]`;
      
      if (isUniqueSelector(dataSelector, element)) {
        return dataSelector;
      }
      
      selectors.push(dataSelector);
    }
  }
  
  // 6. 基于类名的选择器（优先级降低，因为类名容易变化）
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.split(' ')
      .filter(c => c.trim())
      .map(c => CSS.escape(c));
    
    if (classes.length > 0) {
      // 尝试各种类名组合
      for (let i = 1; i <= classes.length; i++) {
        const combinations = getCombinations(classes, i);
        
        for (const combo of combinations) {
          const classSelector = `${element.tagName.toLowerCase()}.${combo.join('.')}`;
          if (isUniqueSelector(classSelector, element)) {
            // 即使找到了基于类名的唯一选择器，也不会立即返回，而是先添加到候选列表
            selectors.push(classSelector);
            // 不立即返回，而是继续找更稳定的选择器
          }
        }
      }
    }
  }
  
  // 7. 合并选择器策略：尝试组合前面生成的选择器，提高唯一性
  for (let i = 0; i < selectors.length; i++) {
    for (let j = i + 1; j < selectors.length; j++) {
      // 合并两个选择器，如果它们不是基于相同策略
      const combinedSelector = `${selectors[i]}, ${selectors[j]}`;
      if (isUniqueSelector(combinedSelector, element)) {
        return combinedSelector;
      }
    }
  }
  
  // 8. 优先返回结构选择器，而不是类名选择器
  // 按照选择器类型的优先级排序
  for (const selector of selectors) {
    // 1. 优先返回结构性选择器
    if (selector.includes(':nth-of-type') || selector.includes(':nth-child') || 
        selector.includes(' > ')) {
      return selector;
    }
  }
  
  // 2. 然后尝试数据属性选择器
  for (const selector of selectors) {
    if (selector.includes('[data-')) {
      return selector;
    }
  }
  
  // 3. 最后才考虑类名选择器
  for (const selector of selectors) {
    if (selector.includes('.')) {
      return selector;
    }
  }
  
  // 9. 如果还是没有找到合适的选择器，返回第一个选择器或者标签名
  return selectors[0] || element.tagName.toLowerCase();
}

// 修改生成结构选择器的方法，使其优先返回更精确的DOM结构选择器
function generateStructuralSelector(element) {
  try {
    // 获取元素在其父元素中的位置
    const parent = element.parentElement;
    if (!parent) return null;
    
    const siblings = Array.from(parent.children);
    const tagName = element.tagName.toLowerCase();
    
    // 计算同类型元素中的索引
    const sameTagSiblings = siblings.filter(el => el.tagName.toLowerCase() === tagName);
    const indexInType = sameTagSiblings.indexOf(element) + 1;
    
    // 计算在所有兄弟元素中的索引
    const indexInAll = siblings.indexOf(element) + 1;
    
    // 构建不同的结构选择器，按优先级排序
    const selectors = [];
    
    // 如果祖父元素存在，优先使用更深层的路径
    if (parent.parentElement) {
      const grandParent = parent.parentElement;
      // 构建3层嵌套的结构选择器 (祖父 > 父亲 > 当前元素)
      selectors.push(`${grandParent.tagName.toLowerCase()} > ${parent.tagName.toLowerCase()} > ${tagName}:nth-of-type(${indexInType})`);
      
      // 尝试4层嵌套
      if (grandParent.parentElement) {
        const greatGrandParent = grandParent.parentElement;
        selectors.push(`${greatGrandParent.tagName.toLowerCase()} > ${grandParent.tagName.toLowerCase()} > ${parent.tagName.toLowerCase()} > ${tagName}:nth-of-type(${indexInType})`);
      }
    }
    
    // 基于标签和nth-of-type
    selectors.push(`${parent.tagName.toLowerCase()} > ${tagName}:nth-of-type(${indexInType})`);
    
    // 基于nth-child
    selectors.push(`${parent.tagName.toLowerCase()} > ${tagName}:nth-child(${indexInAll})`);
    
    // 如果是特定位置的元素（如第一个或最后一个）
    if (indexInType === 1) {
      selectors.push(`${parent.tagName.toLowerCase()} > ${tagName}:first-of-type`);
    }
    
    if (indexInType === sameTagSiblings.length) {
      selectors.push(`${parent.tagName.toLowerCase()} > ${tagName}:last-of-type`);
    }
    
    // 只匹配特定孙元素类型
    selectors.push(`${parent.tagName.toLowerCase()} ${tagName}:nth-of-type(${indexInType})`);
    
    // 逐个测试选择器的唯一性，返回第一个唯一的选择器
    for (const selector of selectors) {
      if (isUniqueSelector(selector, element)) {
        return selector;
      }
    }
    
    // 如果没有唯一选择器，返回第一个
    return selectors[0];
  } catch (e) {
    console.error('生成结构选择器失败:', e);
    return null;
  }
}

// 辅助函数：生成基于父元素ID的选择器
function generateParentBasedSelector(element) {
  // 向上寻找最多4层祖先元素
  let current = element;
  let depth = 0;
  const maxDepth = 4;
  
  while (current.parentElement && depth < maxDepth) {
    current = current.parentElement;
    depth++;
    
    // 如果找到有ID的祖先
    if (current.id) {
      // 构建从此ID元素到目标的路径
      const parts = [];
      let targetEl = element;
      let currentEl = targetEl;
      
      // 向上构建路径，直到找到有ID的元素
      while (currentEl !== current) {
        const tagName = currentEl.tagName.toLowerCase();
        const parent = currentEl.parentElement;
        
        if (!parent) break;
        
        // 找出当前元素在同类型兄弟中的位置
        const siblings = Array.from(parent.children).filter(
          el => el.tagName === currentEl.tagName
        );
        
        if (siblings.length > 1) {
          const index = siblings.indexOf(currentEl) + 1;
          parts.unshift(`${tagName}:nth-of-type(${index})`);
        } else {
          parts.unshift(tagName);
        }
        
        currentEl = parent;
      }
      
      // 构建最终选择器
      return `#${CSS.escape(current.id)} > ${parts.join(' > ')}`;
    }
  }
  
  return null;
}

// 辅助函数：构建更精确的路径选择器
function buildPrecisePathSelector(element) {
  // 从当前元素向上追溯，最多5层
  const path = [];
  let current = element;
  let depth = 0;
  const maxDepth = 5;
  
  while (current && depth < maxDepth) {
    let selector = current.tagName.toLowerCase();
    
    // 添加精确的位置信息
    const parent = current.parentElement;
    if (parent) {
      // 计算同类型元素中的位置
      const siblings = Array.from(parent.children).filter(
        el => el.tagName === current.tagName
      );
      
      if (siblings.length > 1) {
        // 使用更详细的nth-of-type
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }
    
    path.unshift(selector);
    current = current.parentElement;
    depth++;
    
    // 构建中间选择器并测试唯一性
    if (depth >= 2) {
      const partialPath = path.join(' > ');
      if (isUniqueSelector(partialPath, element)) {
        return partialPath;
      }
    }
  }
  
  return path.join(' > ');
}

// 辅助函数：测试选择器是否唯一匹配元素
function isUniqueSelector(selector, element) {
  try {
    const matches = document.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === element;
  } catch (e) {
    return false;
  }
}

// 辅助函数：获取数组的所有组合
function getCombinations(arr, size) {
  const result = [];
  
  function backtrack(start, current) {
    if (current.length === size) {
      result.push([...current]);
      return;
    }
    
    for (let i = start; i < arr.length; i++) {
      current.push(arr[i]);
      backtrack(i + 1, current);
      current.pop();
    }
  }
  
  backtrack(0, []);
  return result;
}

// 生成XPath选择器（结合DOM Inspector的增强功能）
function generateXPathSelector(element) {
  // 首先尝试一个简单但有效的ID选择器
  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }
  
  // 尝试生成更精确的XPath
  try {
    // 递归构建可靠的XPath
    let buildXPath = function(node) {
      // 处理id属性
      if (node.id) {
        return `//*[@id="${node.id}"]`;
      }
      
      // 如果已经到了document，终止递归
      if (!node.parentElement) {
        return '';
      }
      
      // 获取相同类型兄弟元素的位置
      let position = 1;
      let sibling = node;
      
      // 计算相同标签的兄弟节点中的索引
      while (sibling.previousElementSibling) {
        if (sibling.previousElementSibling.tagName === node.tagName) {
          position++;
        }
        sibling = sibling.previousElementSibling;
      }
      
      // 构建当前节点的XPath片段
      const currentPath = `/${node.tagName.toLowerCase()}[${position}]`;
      
      // 递归获取父节点的XPath
      const parentPath = node.parentElement ? buildXPath(node.parentElement) : '';
      
      return parentPath + currentPath;
    };
    
    // 尝试使用文本内容来定位元素（如果它有唯一的文本）
    if (element.textContent && element.textContent.trim()) {
      const textContent = element.textContent.trim();
      // 使用包含文本的方式，对于较长文本只取前30个字符
      const textToUse = textContent.length > 30 ? 
        textContent.substring(0, 30) : textContent;
      
      // 修复XPath语法错误(删除误加的右括号)
      const xpathWithText = `//${element.tagName.toLowerCase()}[contains(text(),"${textToUse.replace(/"/g, "'")}")]`;
      
      // 测试这个XPath是否唯一定位了元素
      try {
        const result = document.evaluate(
          xpathWithText, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
        );
        
        if (result.snapshotLength === 1) {
          return xpathWithText;
        }
      } catch (e) {
        console.log('XPath文本测试失败:', e);
      }
    }
    
    // 使用class属性构建XPath（如果存在）
    if (element.className && typeof element.className === 'string' && element.className.trim()) {
      const classes = element.className.split(' ')
        .filter(cls => cls.trim())
        .map(cls => `contains(@class, '${cls.replace(/'/g, "\\'")}')`);
        
      if (classes.length > 0) {
        const xpathWithClass = `//${element.tagName.toLowerCase()}[${classes.join(' and ')}]`;
        
        // 测试这个XPath是否唯一
        try {
          const result = document.evaluate(
            xpathWithClass, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
          );
          
          if (result.snapshotLength === 1) {
            return xpathWithClass;
          }
        } catch (e) {
          console.log('XPath类名测试失败:', e);
        }
      }
    }
    
    // 尝试使用属性来构建XPath
    const importantAttrs = ['data-id', 'data-testid', 'data-test', 'name', 'title', 'role', 'aria-label', 'alt'];
    for (const attr of importantAttrs) {
      if (element.hasAttribute(attr)) {
        const value = element.getAttribute(attr);
        const xpathWithAttr = `//${element.tagName.toLowerCase()}[@${attr}="${value.replace(/"/g, "'")}"]`;
        
        try {
          const result = document.evaluate(
            xpathWithAttr, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
          );
          
          if (result.snapshotLength === 1) {
            return xpathWithAttr;
          }
        } catch (e) {
          // 忽略此属性，尝试下一个
        }
      }
    }
    
    // 使用递归构建的完整XPath路径作为后备
    return buildXPath(element);
    
  } catch (e) {
    console.error('增强XPath生成失败，使用备选方法', e);
    
    // 备选方法：构建基本的XPath
    let parts = [];
    let currentElement = element;
    
    while (currentElement && currentElement !== document.documentElement) {
      // 获取当前元素的索引
      let index = 1;
      let sibling = currentElement;
      
      // 计算相同类型兄弟元素中的索引
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.tagName === currentElement.tagName) {
          index++;
        }
      }
      
      // 构建 XPath 部分
      const xpathPart = `${currentElement.tagName.toLowerCase()}[${index}]`;
      parts.unshift(xpathPart);
      
      // 向上移动到父元素
      currentElement = currentElement.parentElement;
    }
    
    // 确保返回一个有效的XPath表达式
    return '/' + (parts.length ? parts.join('/') : '');
  }
}

// 获取网站图标
function getFavicon() {
  // 按优先级顺序尝试获取不同的favicon链接
  const iconSelectors = [
    'link[rel="icon"][href]',
    'link[rel="shortcut icon"][href]',
    'link[rel="apple-touch-icon"][href]',
    'link[rel="apple-touch-icon-precomposed"][href]',
    'link[rel="fluid-icon"][href]'
  ];
  
  for (const selector of iconSelectors) {
    const iconLink = document.querySelector(selector);
    if (iconLink && iconLink.href) {
      return iconLink.href;
    }
  }
  
  // 如果找不到任何图标链接，返回网站根目录的favicon.ico
  return `${window.location.origin}/favicon.ico`;
}


// 创建已选择元素的高亮覆盖层
function createSelectedHighlightOverlay(element) {
  // 如果已存在，先移除
  if (selectedHighlightOverlay) {
    document.body.removeChild(selectedHighlightOverlay);
  }
  
  selectedHighlightOverlay = document.createElement('div');
  selectedHighlightOverlay.style.position = 'fixed';
  selectedHighlightOverlay.style.pointerEvents = 'none';
  selectedHighlightOverlay.style.boxSizing = 'border-box';
  selectedHighlightOverlay.style.zIndex = '2147483647'; // 高于普通高亮的z-index，但低于面板的z-index
  selectedHighlightOverlay.style.background = 'rgba(255, 193, 7, 0.2)'; // 黄色高亮
  selectedHighlightOverlay.style.border = '2px solid rgba(255, 193, 7, 0.8)';
  
  const rect = element.getBoundingClientRect();
  selectedHighlightOverlay.style.top = `${rect.top}px`;
  selectedHighlightOverlay.style.left = `${rect.left}px`;
  selectedHighlightOverlay.style.width = `${rect.width}px`;
  selectedHighlightOverlay.style.height = `${rect.height}px`;
  
  document.body.appendChild(selectedHighlightOverlay);
}

// 处理选择确认，更新为使用增强后的选择器生成
function handleSelectionConfirm(element) {
  if (!element) return;
  
  // 生成选择器
  const cssSelector = generateCssSelector(element);
  const xpathSelector = generateXPathSelector(element);
  
  // 停止选择模式
  stopElementSelection();
  
  // 调用回调函数
  if (window.selectionCallback) {
    window.selectionCallback({
      cssSelector,
      xpathSelector,
      element: {
        tagName: element.tagName,
        id: element.id,
        className: element.className,
        text: element.textContent.trim().substring(0, 50) + (element.textContent.length > 50 ? '...' : '')
      },
      html: element.innerHTML
    });
    
    // 清除回调
    window.selectionCallback = null;
  }
  
  // 打开监控任务创建页面
  chrome.runtime.sendMessage({
    action: 'openMonitorPage',
    data: {
      type: 'createTask',
      url: window.location.href,
      title: document.title,
      favicon: getFavicon(),
      selector: cssSelector,
      selectorType: 'css',
      xpathSelector,
      content: element.innerHTML
    }
  });
}

// 创建选择器控制面板
function createSelectorPanel() {
  // 如果已经存在面板，先移除
  if (selectorPanel) {
    document.body.removeChild(selectorPanel);
  }
  
  // 创建面板容器
  selectorPanel = document.createElement('div');
  selectorPanel.id = 'selector-panel';
  selectorPanel.style.position = 'fixed';
  selectorPanel.style.top = '20px';
  selectorPanel.style.right = '20px'; // 放置在右上角
  selectorPanel.style.width = '300px';
  selectorPanel.style.textAlign = 'left';
  selectorPanel.style.backgroundColor = '#ffffff';
  selectorPanel.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.1)';
  selectorPanel.style.borderRadius = '6px';
  selectorPanel.style.zIndex = '2147483647'; // 最高z-index值，确保在页面所有元素之上
  selectorPanel.style.fontFamily = 'Arial, sans-serif';
  selectorPanel.style.fontSize = '13px';
  selectorPanel.style.color = '#333333';
  selectorPanel.style.overflow = 'hidden';
  selectorPanel.style.cursor = 'default';
  
  // 面板头部
  const panelHeader = document.createElement('div');
  panelHeader.style.backgroundColor = '#4a6cf7';
  panelHeader.style.color = 'white';
  panelHeader.style.padding = '12px 15px';
  panelHeader.style.fontWeight = 'bold';
  panelHeader.style.display = 'flex';
  panelHeader.style.justifyContent = 'space-between';
  panelHeader.style.alignItems = 'center';
  
  const title = document.createElement('div');
  title.textContent = '元素选择器';
  
  const closeButton = document.createElement('button');
  closeButton.textContent = '×';
  closeButton.style.background = 'none';
  closeButton.style.border = 'none';
  closeButton.style.color = 'white';
  closeButton.style.fontSize = '18px';
  closeButton.style.cursor = 'pointer';
  closeButton.style.padding = '0';
  closeButton.style.width = '24px';
  closeButton.style.height = '24px';
  closeButton.style.display = 'flex';
  closeButton.style.alignItems = 'center';
  closeButton.style.justifyContent = 'center';
  closeButton.addEventListener('click', function() {
    stopElementSelection();
  });
  
  panelHeader.appendChild(title);
  panelHeader.appendChild(closeButton);
  selectorPanel.appendChild(panelHeader);
  
  // 面板内容区域
  const panelContent = document.createElement('div');
  panelContent.style.padding = '15px';
  selectorPanel.appendChild(panelContent);
  
  // 操作指南
  const guide = document.createElement('div');
  guide.style.marginBottom = '15px';
  guide.style.fontSize = '12px';
  guide.style.lineHeight = '1.5';
  guide.innerHTML = `
    <div style="margin-bottom: 10px; font-weight: bold;">使用说明：</div>
    <div style="margin-bottom: 8px;">移动鼠标到网页内容上选择要监控的元素，完成选择后点击"确认选择"按钮。</div>
    <div style="margin-bottom: 8px; color: #555;">操作方式：</div>
    <ul style="padding-left: 20px; margin-bottom: 10px; color: #555;">
      <li>鼠标在页面上移动 - 预览可选元素</li>
      <li>点击页面元素 - 选中当前元素</li>
      <li>方向键 - 精确定位元素：</li>
      <li style="list-style-type: none; padding-left: 15px; margin-top: 3px;">
        ↑ - 选择父元素<br>
        ↓ - 选择子元素<br>
        ← - 选择前一个同级元素<br>
        → - 选择后一个同级元素
      </li>
      <li style="color: #FF0000;">Enter键 - 确认选择</li>
      <li style="color: #FF0000;">ESC键 - 取消选择</li>
    </ul>
  `;
  panelContent.appendChild(guide);
  
  // 当前选择信息
  const selectionInfo = document.createElement('div');
  selectionInfo.id = 'selection-info';
  selectionInfo.style.marginBottom = '15px';
  selectionInfo.style.padding = '10px';
  selectionInfo.style.backgroundColor = '#f5f5f5';
  selectionInfo.style.borderRadius = '4px';
  selectionInfo.style.border = '1px solid #e0e0e0';
  selectionInfo.style.minHeight = '50px';
  selectionInfo.style.lineHeight = '1.4';
  selectionInfo.innerHTML = '<div style="color: #666;">未选择元素</div>';
  panelContent.appendChild(selectionInfo);
  
  // CSS选择器信息
  const selectorInfo = document.createElement('div');
  selectorInfo.id = 'selector-info';
  selectorInfo.style.marginBottom = '15px';
  selectorInfo.style.fontFamily = 'monospace';
  selectorInfo.style.fontSize = '12px';
  selectorInfo.style.whiteSpace = 'normal'; // 允许文本换行
  selectorInfo.style.overflow = 'visible'; // 移除溢出隐藏
  selectorInfo.style.wordBreak = 'break-all'; // 确保长文本会在任何字符处换行
  selectorInfo.innerHTML = '<div style="color: #666;">未生成选择器</div>';
  panelContent.appendChild(selectorInfo);
  
  // 按钮区域
  const buttonArea = document.createElement('div');
  buttonArea.style.display = 'flex';
  buttonArea.style.justifyContent = 'space-between';
  
  // 确认按钮
  const confirmButton = document.createElement('button');
  confirmButton.id = 'confirm-element-btn';
  confirmButton.textContent = '确认选择';
  confirmButton.style.backgroundColor = '#4a6cf7';
  confirmButton.style.color = 'white';
  confirmButton.style.border = 'none';
  confirmButton.style.borderRadius = '4px';
  confirmButton.style.padding = '8px 16px';
  confirmButton.style.fontSize = '14px';
  confirmButton.style.cursor = 'pointer';
  confirmButton.style.flexGrow = '1';
  confirmButton.style.marginRight = '10px';
  confirmButton.disabled = true;
  confirmButton.style.opacity = '0.6';
  confirmButton.addEventListener('click', function() {
    if (selectedElement) {
      handleSelectionConfirm(selectedElement);
    }
  });
  
  // 取消按钮
  const cancelButton = document.createElement('button');
  cancelButton.textContent = '取消';
  cancelButton.style.backgroundColor = '#f5f5f5';
  cancelButton.style.color = '#333';
  cancelButton.style.border = '1px solid #ddd';
  cancelButton.style.borderRadius = '4px';
  cancelButton.style.padding = '8px 16px';
  cancelButton.style.fontSize = '14px';
  cancelButton.style.cursor = 'pointer';
  cancelButton.addEventListener('click', function() {
    stopElementSelection();
  });
  
  buttonArea.appendChild(confirmButton);
  buttonArea.appendChild(cancelButton);
  panelContent.appendChild(buttonArea);
  
  // 将面板添加到文档中
  document.body.appendChild(selectorPanel);
}

// 显示提取的内容
function showExtractedContent(content, isLoading = false) {
  // 移除已有的提示框
  if (contentToastOverlay) {
    document.body.removeChild(contentToastOverlay);
    contentToastOverlay = null;
  }
  
  // 创建提示框覆盖层
  contentToastOverlay = document.createElement('div');
  contentToastOverlay.style.position = 'fixed';
  contentToastOverlay.style.top = '20px';
  contentToastOverlay.style.right = '20px';
  contentToastOverlay.style.maxWidth = '400px';
  contentToastOverlay.style.maxHeight = '300px';
  contentToastOverlay.style.overflow = 'auto';
  contentToastOverlay.style.backgroundColor = 'white';
  contentToastOverlay.style.padding = '15px';
  contentToastOverlay.style.borderRadius = '8px';
  contentToastOverlay.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2)';
  contentToastOverlay.style.zIndex = '2147483646'; // 确保在UI层之上，但在选择器面板之下
  
  // 创建标题
  const title = document.createElement('div');
  title.style.marginBottom = '10px';
  title.style.fontWeight = 'bold';
  title.style.color = '#4a6cf7';
  title.style.fontSize = '14px';
  title.style.display = 'flex';
  title.style.justifyContent = 'space-between';
  title.style.alignItems = 'center';
  title.textContent = isLoading ? '检测中，请稍候...' : '提取内容预览';
  
  // 添加关闭按钮
  const closeButton = document.createElement('button');
  closeButton.innerHTML = '&times;';
  closeButton.style.background = 'none';
  closeButton.style.border = 'none';
  closeButton.style.color = '#4a6cf7';
  closeButton.style.fontSize = '18px';
  closeButton.style.cursor = 'pointer';
  closeButton.style.marginLeft = '10px';
  closeButton.addEventListener('click', () => {
    if (document.body.contains(contentToastOverlay)) {
      document.body.removeChild(contentToastOverlay);
      contentToastOverlay = null;
    }
  });
  
  title.appendChild(closeButton);
  contentToastOverlay.appendChild(title);
  
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
    spinner.style.borderTop = '3px solid #4a6cf7';
    spinner.style.borderRadius = '50%';
    spinner.style.width = '24px';
    spinner.style.height = '24px';
    spinner.style.animation = 'spin 1s linear infinite';
    spinner.style.marginBottom = '10px';
    
    // 添加动画样式
    const style = document.createElement('style');
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
    
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
  
  contentToastOverlay.appendChild(contentContainer);
  
  // 添加到页面
  document.body.appendChild(contentToastOverlay);
  
  if (!isLoading) {
    // 10秒后自动关闭
    setTimeout(() => {
      if (contentToastOverlay && document.body.contains(contentToastOverlay)) {
        document.body.removeChild(contentToastOverlay);
        contentToastOverlay = null;
      }
    }, 10000);
  }
  
  // 返回对象，便于外部控制
  return {
    close: () => {
      if (contentToastOverlay && document.body.contains(contentToastOverlay)) {
        document.body.removeChild(contentToastOverlay);
        contentToastOverlay = null;
      }
    },
    update: (newContent, stillLoading = false) => {
      if (contentToastOverlay) {
        // 更新标题
        const titleElement = contentToastOverlay.querySelector('div');
        if (titleElement) {
          titleElement.textContent = stillLoading ? '检测中，请稍候...' : '提取内容预览';
        }
        
        // 更新内容
        const contentElement = contentToastOverlay.querySelector('div:nth-child(2)');
        if (contentElement) {
          if (stillLoading) {
            // 保持加载动画
          } else {
            contentElement.innerHTML = newContent;
          }
        }
      }
    }
  };
} 