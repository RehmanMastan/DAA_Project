/*
GraphLab Script
Author: Chatbox AI
Date: 2026-10-25

Sections:
1. Graph data model.
2. Graph editing operations.
3. BFS algorithm.
4. DFS algorithm.
5. Traversal-step generation.
6. SVG rendering and node positioning.
7. Selection and pointer interactions.
8. Playback controller.
9. Inspector and statistics rendering.
10. Comparison calculations.
11. Event listeners and initialization.
*/

"use strict";

/* ====== 1. Graph data model ====== */
const GraphLab = (function () {
  // Internal unique ID counter for nodes
  let nodeIdCounter = 0;

  // Data structures
  let nodes = new Map(); // id => { id, label, x, y }
  let adjacency = new Map(); // id => Set of connected node ids

  // Action history for undo
  let historyStack = [];

  // Current selected node id
  let selectedNodeId = null;

  // Modes
  let mode = {
    newNode: false,
    connect: false,
    delete: false,
  };

  // Connect mode state
  let connectFirstNodeId = null;

  // Algorithm related
  let algorithmState = {
    name: null,
    steps: [],
    currentStepIndex: -1,
    running: false,
    speed: 800,
    timerId: null,
    traversalValid: false,
    lastStartNodeId: null,
  };

  // Playback
  let playback = {
    playing: false,
  };

  // Get unique node label (A, B, C... Z, AA, AB...)
  function getNextNodeLabel() {
    const total = nodes.size;
    if (total === 0) return "A";
    // Convert number to base-26 letter representation
    let n = total;
    let label = "";
    do {
      label = String.fromCharCode(65 + (n % 26)) + label;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    // Ensure label isn't already used (due to renaming or deletions)
    if ([...nodes.values()].some((node) => node.label === label)) {
      // Increment if duplicate label
      return getNextNodeLabelModified(total + 1);
    }
    return label;
  }

  // Helper for label generation to avoid collisions
  function getNextNodeLabelModified(num) {
    let n = num;
    let label = "";
    do {
      label = String.fromCharCode(65 + (n % 26)) + label;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    if ([...nodes.values()].some((node) => node.label === label)) {
      return getNextNodeLabelModified(num + 1);
    }
    return label;
  }

  // Add a new node with an optional position
  function addNode(x = 100, y = 100) {
    if (!mode.newNode) return null;
    // Create a new node id
    const id = `n${nodeIdCounter++}`;
    const label = getNextNodeLabel();
    nodes.set(id, { id, label, x, y });
    adjacency.set(id, new Set());
    pushHistory({
      action: "addNode",
      nodeId: id,
    });
    return id;
  }

  // Rename a node safely
  function renameNode(id, newLabel) {
    if (!nodes.has(id)) return false;
    if (typeof newLabel !== "string") return false;
    newLabel = newLabel.trim().toUpperCase().slice(0, 3);
    if (newLabel.length === 0) return false;
    // Prevent duplicate labels
    for (const node of nodes.values()) {
      if (node.label === newLabel && node.id !== id) return false;
    }
    const oldLabel = nodes.get(id).label;
    nodes.get(id).label = newLabel;
    pushHistory({
      action: "renameNode",
      nodeId: id,
      oldLabel,
      newLabel,
    });
    return true;
  }

  // Delete a node and all connected edges
  function deleteNode(id) {
    if (!nodes.has(id)) return false;
    // Remove edges referencing this node
    const neighbors = adjacency.get(id);
    for (const nId of neighbors) {
      adjacency.get(nId).delete(id);
    }
    adjacency.delete(id);
    nodes.delete(id);
    if (selectedNodeId === id) selectedNodeId = null;
    pushHistory({
      action: "deleteNode",
      node: JSON.parse(JSON.stringify(nodes.get(id))),
      nodeId: id,
      edges: [...neighbors],
    });
    return true;
  }

  // Add an undirected edge
  function addEdge(id1, id2) {
    if (!nodes.has(id1) || !nodes.has(id2)) return false;
    if (id1 === id2) return false; // no self-connections
    if (adjacency.get(id1).has(id2)) return false; // duplicate edge
    adjacency.get(id1).add(id2);
    adjacency.get(id2).add(id1);
    pushHistory({
      action: "addEdge",
      edge: [id1, id2],
    });
    return true;
  }

  // Delete an edge
  function deleteEdge(id1, id2) {
    if (!nodes.has(id1) || !nodes.has(id2)) return false;
    if (!adjacency.get(id1).has(id2)) return false;
    adjacency.get(id1).delete(id2);
    adjacency.get(id2).delete(id1);
    pushHistory({
      action: "deleteEdge",
      edge: [id1, id2],
    });
    return true;
  }

  // Clear the entire graph
  function clearGraph() {
    nodes.clear();
    adjacency.clear();
    selectedNodeId = null;
    nodeIdCounter = 0;
    clearHistory();
    invalidateTraversal();
  }

  // Load example graph (7-9 nodes, cycles, branches, disconnected)
  function loadExampleGraph() {
    clearGraph();

    // Add nodes A-I (9)
    const exampleNodes = [
      { id: "n0", label: "A" },
      { id: "n1", label: "B" },
      { id: "n2", label: "C" },
      { id: "n3", label: "D" },
      { id: "n4", label: "E" },
      { id: "n5", label: "F" },
      { id: "n6", label: "G" },
      { id: "n7", label: "H" },
      { id: "n8", label: "I" },
    ];
    exampleNodes.forEach((n, i) => {
      nodes.set(n.id, {
        id: n.id,
        label: n.label,
        x: 150 + 90 * i,
        y: 150 + ((i % 3) * 120),
      });
      adjacency.set(n.id, new Set());
    });
    nodeIdCounter = 9;

    // Add edges including cycles and disconnected component
    // Component 1: A-B-C-D (with cycle B-C-D)
    addEdge("n0", "n1"); // A-B
    addEdge("n1", "n2"); // B-C
    addEdge("n2", "n3"); // C-D
    addEdge("n3", "n1"); // D-B cycle

    // Component 2: E-F-G (line)
    addEdge("n4", "n5"); // E-F
    addEdge("n5", "n6"); // F-G

    // Component 3: H-I disconnected
    addEdge("n7", "n8"); // H-I

    invalidateTraversal();
    pushHistory({
      action: "loadExample",
      nodes: JSON.parse(JSON.stringify([...nodes.values()])),
      adjacency: serializeAdjacency(),
    });
  }

  function serializeAdjacency() {
    const result = {};
    for (const [id, neighbors] of adjacency.entries()) {
      result[id] = [...neighbors];
    }
    return result;
  }

  function deserializeAdjacency(serialized) {
    adjacency.clear();
    for (const id in serialized) {
      adjacency.set(id, new Set(serialized[id]));
    }
  }

  // Select node
  function selectNode(id) {
    if (!id || !nodes.has(id)) {
      selectedNodeId = null;
      return;
    }
    selectedNodeId = id;
  }

  // Undo last graph edit
  function undoLastEdit() {
    if (historyStack.length === 0) return false;
    const lastAction = historyStack.pop();
    switch (lastAction.action) {
      case "addNode":
        nodes.delete(lastAction.nodeId);
        adjacency.delete(lastAction.nodeId);
        if (selectedNodeId === lastAction.nodeId) selectedNodeId = null;
        break;
      case "renameNode":
        if (nodes.has(lastAction.nodeId))
          nodes.get(lastAction.nodeId).label = lastAction.oldLabel;
        break;
      case "deleteNode":
        if (lastAction.node) {
          const n = lastAction.node;
          nodes.set(n.id, n);
          adjacency.set(n.id, new Set());
          if (lastAction.edges && lastAction.edges.length) {
            for (const neighborId of lastAction.edges) {
              if (nodes.has(neighborId)) {
                adjacency.get(n.id).add(neighborId);
                adjacency.get(neighborId).add(n.id);
              }
            }
          }
        }
        break;
      case "addEdge":
        if (lastAction.edge.length === 2) {
          const [a, b] = lastAction.edge;
          adjacency.get(a)?.delete(b);
          adjacency.get(b)?.delete(a);
        }
        break;
      case "deleteEdge":
        if (lastAction.edge.length === 2) {
          const [a, b] = lastAction.edge;
          adjacency.get(a)?.add(b);
          adjacency.get(b)?.add(a);
        }
        break;
      case "loadExample":
        // Undo load example: clear graph entirely
        clearGraph();
        break;
    }
    invalidateTraversal();
    return true;
  }

  // History management
  function pushHistory(action) {
    historyStack.push(action);
    if (historyStack.length > 100) {
      historyStack.shift();
    }
  }
  function clearHistory() {
    historyStack = [];
  }

  // Update node position after dragging
  function updateNodePosition(id, x, y) {
    if (!nodes.has(id)) return false;
    nodes.get(id).x = x;
    nodes.get(id).y = y;
    return true;
  }

  // Reset node positions based on layout
  function resetNodePositions(layout) {
    const allNodeIds = Array.from(nodes.keys());
    if (allNodeIds.length === 0) return;
    if (layout === "circular") {
      // Arrange nodes in circle around center
      const cx = 400; // Approx canvas center X
      const cy = 300; // Approx canvas center Y
      const radius = Math.min(cx, cy) - 80;
      const n = allNodeIds.length;
      allNodeIds.forEach((id, i) => {
        const angle = (2 * Math.PI * i) / n;
        nodes.get(id).x = cx + radius * Math.cos(angle);
        nodes.get(id).y = cy + radius * Math.sin(angle);
      });
    } else if (layout === "layered") {
      let layerHeight = 100;
      let xStart = 150;
      let yStart = 150;
      // Assign layers based on BFS levels from first node (or arbitrary)
      const startId = allNodeIds[0];
      let levels = {};
      let visited = new Set();
      let queue = [];
      queue.push(startId);
      levels[startId] = 0;
      visited.add(startId);
      while (queue.length > 0) {
        const current = queue.shift();
        const level = levels[current];
        adjacency.get(current).forEach((nbr) => {
          if (!visited.has(nbr)) {
            levels[nbr] = level + 1;
            queue.push(nbr);
            visited.add(nbr);
          }
        });
      }
      // Place nodes layer-wise
      const maxLevel = Math.max(...Object.values(levels));
      for (let l = 0; l <= maxLevel; l++) {
        const nodesOnLevel = allNodeIds.filter((id) => levels[id] === l);
        const count = nodesOnLevel.length;
        const spacingX = 600 / (count + 1);
        nodesOnLevel.forEach((id, i) => {
          nodes.get(id).x = xStart + spacingX * (i + 1);
          nodes.get(id).y = yStart + l * layerHeight;
        });
      }
      // For isolated/disconnected nodes with no level, assign bottom positions
      allNodeIds.forEach((id) => {
        if (levels[id] === undefined) {
          nodes.get(id).x = xStart + 50;
          nodes.get(id).y = yStart + (maxLevel + 1) * layerHeight;
        }
      });
    }
  }

  // Invalidate traversal on edits
  function invalidateTraversal() {
    algorithmState.steps = [];
    algorithmState.currentStepIndex = -1;
    algorithmState.running = false;
    algorithmState.traversalValid = false;
    algorithmState.name = null;
    algorithmState.lastStartNodeId = null;
    if (algorithmState.timerId) {
      clearInterval(algorithmState.timerId);
      algorithmState.timerId = null;
    }
    playback.playing = false;
  }

  /* ====== 3 & 4 BFS & DFS Algorithms and traversal recording ====== */

  /**
   * BFS Implementation with step recording.
   * The traversal steps record the current node, queue, discovered and completed sets,
   * the currently active edge, operation message, etc.
   *
   * @param {string} startNodeId
   * @returns {Array} steps
   */
  function runBFS(startNodeId) {
    const steps = [];
    if (!nodes.has(startNodeId)) return steps;
    const discovered = new Set();
    const completed = new Set();
    const queue = [];
    const traversalOrder = [];

    let prevNode = null;

    // Helper function to record step
    function recordStep(currentNode, currentEdge, opMessage) {
      steps.push({
        currentNode,
        currentEdge,
        discovered: new Set(discovered),
        completed: new Set(completed),
        queue: [...queue],
        traversalOrder: [...traversalOrder],
        opMessage,
      });
    }

    discovered.add(startNodeId);
    queue.push(startNodeId);
    recordStep(null, null, `Starting BFS from node ${nodes.get(startNodeId).label}.`);

    while (queue.length > 0) {
      const nodeId = queue.shift();
      traversalOrder.push(nodeId);
      recordStep(
        nodeId,
        prevNode ? [prevNode, nodeId] : null,
        `Node ${nodes.get(nodeId).label} dequeued and discovered.`
      );
      for (const neighborId of adjacency.get(nodeId)) {
        if (!discovered.has(neighborId)) {
          discovered.add(neighborId);
          queue.push(neighborId);
          recordStep(
            neighborId,
            [nodeId, neighborId],
            `Node ${nodes.get(neighborId).label} discovered and added to queue.`
          );
        } else {
          // Already discovered, skip
          recordStep(
            neighborId,
            [nodeId, neighborId],
            `Node ${nodes.get(neighborId).label} already discovered, skipping.`
          );
        }
      }
      completed.add(nodeId);
      recordStep(nodeId, null, `Node ${nodes.get(nodeId).label} fully processed.`);
      prevNode = nodeId;
    }
    // Final step summary
    recordStep(null, null, `BFS traversal completed. Visited ${traversalOrder.length} nodes.`);
    return steps;
  }

  /**
   * DFS Implementation with step recording.
   * Uses an explicit stack to control traversal order.
   * Records backtracking events explicitly.
   *
   * @param {string} startNodeId
   * @returns {Array} steps
   */
  function runDFS(startNodeId) {
    const steps = [];
    if (!nodes.has(startNodeId)) return steps;

    const discovered = new Set();
    const completed = new Set();
    const stack = [];
    const traversalOrder = [];

    // Stack for iteration: each element is { nodeId, neighborsIter }
    // neighborsIter is an iterator of neighbors to explore next
    stack.push({
      nodeId: startNodeId,
      neighbors: adjacency.get(startNodeId)[Symbol.iterator](),
    });
    discovered.add(startNodeId);

    let prevNode = null;

    // Record initial step
    steps.push({
      currentNode: startNodeId,
      currentEdge: null,
      discovered: new Set(discovered),
      completed: new Set(completed),
      stack: stack.map((e) => e.nodeId),
      traversalOrder: [...traversalOrder],
      opMessage: `Starting DFS from node ${nodes.get(startNodeId).label}.`,
    });

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const nodeId = top.nodeId;

      // If node not yet in traversal order, add it
      if (!traversalOrder.includes(nodeId)) {
        traversalOrder.push(nodeId);
        steps.push({
          currentNode: nodeId,
          currentEdge: prevNode ? [prevNode, nodeId] : null,
          discovered: new Set(discovered),
          completed: new Set(completed),
          stack: stack.map((e) => e.nodeId),
          traversalOrder: [...traversalOrder],
          opMessage: `Node ${nodes.get(nodeId).label} discovered and visited.`,
        });
      }

      let nextNeighbor = null;
      // Find next undiscovered neighbor
      while (true) {
        const result = top.neighbors.next();
        if (result.done) {
          nextNeighbor = null;
          break;
        }
        if (!discovered.has(result.value)) {
          nextNeighbor = result.value;
          break;
        } else {
          // Mark already discovered neighbor step
          steps.push({
            currentNode: nodeId,
            currentEdge: [nodeId, result.value],
            discovered: new Set(discovered),
            completed: new Set(completed),
            stack: stack.map((e) => e.nodeId),
            traversalOrder: [...traversalOrder],
            opMessage: `Neighbor ${nodes.get(result.value).label} already discovered; skipping.`,
          });
        }
      }

      if (nextNeighbor) {
        // Push neighbor to stack
        discovered.add(nextNeighbor);
        stack.push({ nodeId: nextNeighbor, neighbors: adjacency.get(nextNeighbor)[Symbol.iterator]() });
        steps.push({
          currentNode: nextNeighbor,
          currentEdge: [nodeId, nextNeighbor],
          discovered: new Set(discovered),
          completed: new Set(completed),
          stack: stack.map((e) => e.nodeId),
          traversalOrder: [...traversalOrder],
          opMessage: `Neighbor ${nodes.get(nextNeighbor).label} discovered and pushed to stack.`,
        });
        prevNode = nodeId;
      } else {
        // No more neighbors: backtrack
        const finishedNode = stack.pop().nodeId;
        completed.add(finishedNode);
        steps.push({
          currentNode: finishedNode,
          currentEdge: null,
          discovered: new Set(discovered),
          completed: new Set(completed),
          stack: stack.map((e) => e.nodeId),
          traversalOrder: [...traversalOrder],
          opMessage: `Backtracking from node ${nodes.get(finishedNode).label}. Node fully processed.`,
        });
        prevNode = finishedNode;
      }
    }

    steps.push({
      currentNode: null,
      currentEdge: null,
      discovered: new Set(discovered),
      completed: new Set(completed),
      stack: [],
      traversalOrder: [...traversalOrder],
      opMessage: `DFS traversal completed. Visited ${traversalOrder.length} nodes.`,
    });

    return steps;
  }

  /* ====== 6. SVG Rendering and Node Positioning ====== */

  // SVG elements references
  const svg = document.getElementById("graph-svg");

  // For scaling/coordinate transforms, setup SVG viewBox: fixed 800x600
  const SVG_WIDTH = 800;
  const SVG_HEIGHT = 600;

  // Clear svg content and reset viewBox
  function clearSVG() {
    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }
    svg.setAttribute("viewBox", `0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`);
  }

  // Create SVG elements helpers
  function createSVGElement(tag, attrs = {}) {
    const elem = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, val] of Object.entries(attrs)) {
      elem.setAttribute(key, val);
    }
    return elem;
  }

  // State for dragging
  let dragData = {
    dragging: false,
    draggedNodeId: null,
    offsetX: 0,
    offsetY: 0,
  };

  // Store references to SVG node circles and labels for event handling
  let svgNodeMap = new Map(); // nodeId => {circle, label}

  // Store references to lines for edges, keyed by sorted nodeId pair string "id1-id2"
  let svgEdgeMap = new Map();

  // Key helpers:
  function edgeKey(id1, id2) {
    // Always keep ascending order
    return id1 < id2 ? `${id1}-${id2}` : `${id2}-${id1}`;
  }

  // Render the entire graph SVG
  function renderGraph() {
    clearSVG();
    svgNodeMap.clear();
    svgEdgeMap.clear();

    const nodeIds = Array.from(nodes.keys());
    if (nodeIds.length === 0) {
      document.getElementById("empty-graph-msg").style.display = "block";
      return;
    } else {
      document.getElementById("empty-graph-msg").style.display = "none";
    }

    // Draw edges first so they appear behind nodes
    adjacency.forEach((neighbors, id) => {
      neighbors.forEach((nbrId) => {
        // Draw edge only once (undirected)
        if (id < nbrId) {
          const node1 = nodes.get(id);
          const node2 = nodes.get(nbrId);
          const edge = createSVGElement("line", {
            x1: node1.x,
            y1: node1.y,
            x2: node2.x,
            y2: node2.y,
            class: "edge",
            "data-edge": edgeKey(id, nbrId),
            "stroke-linecap": "round",
          });
          svg.appendChild(edge);
          svgEdgeMap.set(edgeKey(id, nbrId), edge);
          // Add edge click handler for deletion in delete mode
          edge.addEventListener("click", (e) => {
            if (mode.delete) {
              deleteEdge(id, nbrId);
              updateAfterEdit();
            }
          });
        }
      });
    });

    // Draw nodes on top
    nodes.forEach((node) => {
      // Group for circle and label
      const gNode = createSVGElement("g", { class: "node-group", "data-id": node.id });
      // Circle
      const circle = createSVGElement("circle", {
        cx: node.x,
        cy: node.y,
        r: 18,
        class: "node node-unvisited",
        "data-id": node.id,
        tabindex: "0",
        role: "button",
        "aria-label": `Node ${node.label}`,
      });
      // Label text
      const label = createSVGElement("text", {
        x: node.x,
        y: node.y,
        class: "node-label-text",
      });
      label.textContent = node.label;

      gNode.appendChild(circle);
      gNode.appendChild(label);
      svg.appendChild(gNode);
      svgNodeMap.set(node.id, { circle, label, group: gNode });

      // Node event listeners
      circle.addEventListener("mousedown", nodePointerDown);
      circle.addEventListener("touchstart", nodePointerDown, { passive: false });
      circle.addEventListener("click", (e) => {
        e.stopPropagation();
        onNodeClick(node.id);
      });
      circle.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onNodeClick(node.id);
        }
      });
    });
  }

  /* ====== 7. Selection and Pointer Interactions ====== */

  // Handle node click
  function onNodeClick(id) {
    if (mode.newNode) return; // Do nothing if in newNode mode & clicked node (new nodes on empty canvas)
    if (mode.delete) {
      deleteNode(id);
      updateAfterEdit();
      return;
    }
    if (mode.connect) {
      if (connectFirstNodeId === null) {
        connectFirstNodeId = id;
        showToast(`Select second node to connect to ${nodes.get(id).label}.`);
      } else if (connectFirstNodeId === id) {
        showToast("Cannot connect node to itself. Select a different node.");
      } else {
        const success = addEdge(connectFirstNodeId, id);
        if (success) {
          showToast(`Edge created between ${nodes.get(connectFirstNodeId).label} and ${nodes.get(id).label}.`);
        } else {
          showToast("Edge already exists or invalid connection.");
        }
        connectFirstNodeId = null;
        updateAfterEdit();
      }
      return;
    }
    selectNode(id);
    renderInspector();
    updatePlaybackStatus("Ready");
    updateGraphHighlights();
  }

  // Canvas click - add node if mode.newNode
  svg.addEventListener("click", (e) => {
    if (!mode.newNode) return;
    // Get mouse position in SVG coords
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
    const newNodeId = addNode(svgP.x, svgP.y);
    if (newNodeId) {
      selectNode(newNodeId);
      renderGraph();
      renderInspector();
      updatePlaybackStatus("Ready");
    }
  });

  // Drag and Drop for nodes
  svg.addEventListener("pointerdown", (e) => {
    if (e.target.tagName !== "circle") return;
    dragData.dragging = true;
    dragData.draggedNodeId = e.target.getAttribute("data-id");
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
    const node = nodes.get(dragData.draggedNodeId);
    dragData.offsetX = svgP.x - node.x;
    dragData.offsetY = svgP.y - node.y;
    // Add pointercapture for smooth dragging
    e.target.setPointerCapture(e.pointerId);
  });

  svg.addEventListener("pointermove", (e) => {
    if (!dragData.dragging || !dragData.draggedNodeId) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
    const x = svgP.x - dragData.offsetX;
    const y = svgP.y - dragData.offsetY;
    updateNodePosition(dragData.draggedNodeId, x, y);
    renderGraph();
    updateGraphHighlights();
    renderInspector();
  });

  svg.addEventListener("pointerup", (e) => {
    if (dragData.dragging && dragData.draggedNodeId) {
      dragData.dragging = false;
      dragData.draggedNodeId = null;
      updateAfterEdit();
    }
  });

  svg.addEventListener("pointercancel", (e) => {
    if (dragData.dragging) {
      dragData.dragging = false;
      dragData.draggedNodeId = null;
    }
  });

  // Prevent accidental drag triggering new node creation or selection
  // by using the dragData state.

  /* ====== 8. Playback Controller ====== */

  // Playback control elements
  const statusIndicator = document.getElementById("status-indicator");
  const playPrevBtn = document.getElementById("play-prev");
  const playPlayBtn = document.getElementById("play-play");
  const playPauseBtn = document.getElementById("play-pause");
  const playNextBtn = document.getElementById("play-next");
  const playRestartBtn = document.getElementById("play-restart");
  const playbackSpeedInput = document.getElementById("playback-speed");
  const stepIndicator = document.getElementById("step-indicator");
  const playbackProgress = document.getElementById("playback-progress");

  // Current algorithm playback state
  // Use algorithmState.steps and algorithmState.currentStepIndex

  // Helper to update status message (Ready, Running, Paused, Completed)
  function updatePlaybackStatus(status) {
    statusIndicator.className = `status ${status.toLowerCase()}`;
    statusIndicator.textContent = `Status: ${status}`;
  }

  // Update UI after graph editing operations
  function updateAfterEdit() {
    invalidateTraversal();
    renderGraph();
    renderInspector();
    updateGraphHighlights();
    updateUndoButton();
    updatePlaybackStatus("Ready");
    populateStartNodeSelect();
  }

  // Update Undo button enabled state
  function updateUndoButton() {
    const undoBtn = document.getElementById("btn-undo");
    undoBtn.disabled = historyStack.length === 0;
  }

  // Playback functions
  function goToStep(index) {
    if (!algorithmState.traversalValid) return;
    index = Math.max(0, Math.min(index, algorithmState.steps.length - 1));
    algorithmState.currentStepIndex = index;
    renderAlgorithmStep(algorithmState.steps[index]);
    updatePlaybackUI();
  }

  function nextStep() {
    if (!algorithmState.traversalValid) return;
    if (algorithmState.currentStepIndex < algorithmState.steps.length - 1) {
      goToStep(algorithmState.currentStepIndex + 1);
    } else {
      pausePlayback();
      updatePlaybackStatus("Completed");
    }
  }

  function prevStep() {
    if (!algorithmState.traversalValid) return;
    if (algorithmState.currentStepIndex > 0) {
      goToStep(algorithmState.currentStepIndex - 1);
      updatePlaybackStatus("Running");
    }
  }

  function playTraversal() {
    if (!algorithmState.traversalValid) return;
    if (playback.playing) return; // Already playing
    playback.playing = true;
    updatePlaybackStatus("Running");
    playPlayBtn.disabled = true;
    playPauseBtn.disabled = false;

    algorithmState.timerId = setInterval(() => {
      if (algorithmState.currentStepIndex < algorithmState.steps.length - 1) {
        nextStep();
      } else {
        pausePlayback();
        updatePlaybackStatus("Completed");
      }
    }, algorithmState.speed);
  }

  function pausePlayback() {
    playback.playing = false;
    playPlayBtn.disabled = false;
    playPauseBtn.disabled = true;
    if (algorithmState.timerId) {
      clearInterval(algorithmState.timerId);
      algorithmState.timerId = null;
    }
    updatePlaybackStatus("Paused");
  }

  function restartTraversal() {
    if (!algorithmState.traversalValid) return;
    pausePlayback();
    goToStep(0);
    updatePlaybackStatus("Ready");
  }

  function updatePlaybackSpeed(speed) {
    algorithmState.speed = speed;
    if (playback.playing && algorithmState.timerId) {
      clearInterval(algorithmState.timerId);
      algorithmState.timerId = setInterval(() => {
        if (algorithmState.currentStepIndex < algorithmState.steps.length - 1) {
          nextStep();
        } else {
          pausePlayback();
          updatePlaybackStatus("Completed");
        }
      }, speed);
    }
  }

  // Update playback controls UI
  function updatePlaybackUI() {
    const current = algorithmState.currentStepIndex + 1;
    const total = algorithmState.steps.length;
    stepIndicator.textContent = `Step ${current} / ${total}`;
    playbackProgress.max = total;
    playbackProgress.value = current;
  }

  // Render a specific algorithm step on the graph
  function renderAlgorithmStep(step) {
    if (!step) return;

    const { currentNode, currentEdge, discovered, completed, queue, stack, traversalOrder, opMessage } = step;

    // Color nodes
    svgNodeMap.forEach(({circle}, id) => {
      circle.classList.remove(
        "node-unvisited",
        "node-discovered",
        "node-active",
        "node-completed"
      );
      if (id === selectedNodeId) {
        circle.classList.add("node-selected");
      } else {
        circle.classList.remove("node-selected");
      }
      if (currentNode === id) {
        circle.classList.add("node-active");
      } else if (completed && completed.has(id)) {
        circle.classList.add("node-completed");
      } else if (discovered && discovered.has(id)) {
        circle.classList.add("node-discovered");
      } else {
        circle.classList.add("node-unvisited");
      }
    });

    // Color edges
    svgEdgeMap.forEach((line, key) => {
      line.classList.remove("edge-active", "edge-used");
      if (!currentEdge) return;
      const [a, b] = currentEdge;
      const edgeId = edgeKey(a, b);
      if (key === edgeId) {
        line.classList.add("edge-active");
      } else if (completed && completed.has(a) && completed.has(b)) {
        line.classList.add("edge-used");
      }
    });

    // Update algorithm inspector with step info
    updateAlgorithmInspector(step);
  }

  /* ====== 9. Inspector and statistics rendering ====== */

  function renderInspector() {
    // Selected Node Info
    const nodeLabelDisplay = document.getElementById("node-label-display");
    const nodeRenameInput = document.getElementById("node-rename-input");
    const nodeDegreeDisplay = document.getElementById("node-degree");
    const nodeNeighborsDisplay = document.getElementById("node-neighbors");

    if (!selectedNodeId || !nodes.has(selectedNodeId)) {
      nodeLabelDisplay.textContent = "None";
      nodeRenameInput.value = "";
      nodeDegreeDisplay.textContent = "";
      nodeNeighborsDisplay.textContent = "";
      nodeRenameInput.disabled = true;
      return;
    }
    const node = nodes.get(selectedNodeId);
    nodeLabelDisplay.textContent = node.label;
    nodeRenameInput.value = node.label;
    nodeRenameInput.disabled = false;

    const degree = adjacency.get(selectedNodeId)?.size || 0;
    nodeDegreeDisplay.textContent = `Degree: ${degree}`;
    const neighbors = [...adjacency.get(selectedNodeId) || []]
      .map((id) => nodes.get(id)?.label)
      .filter(Boolean)
      .sort()
      .join(", ");
    nodeNeighborsDisplay.textContent = `Neighbors: ${neighbors || "None"}`;

    // Graph stats
    document.getElementById("stat-nodes").textContent = nodes.size;
    let edgeCount = 0;
    adjacency.forEach((neighbors) => (edgeCount += neighbors.size));
    document.getElementById("stat-edges").textContent = edgeCount / 2;
  }

  function updateAlgorithmInspector(step) {
    if (!step) return;

    document.getElementById("stat-algorithm").textContent = algorithmState.name || "-";
    document.getElementById("stat-current-node").textContent = step.currentNode ? nodes.get(step.currentNode)?.label || "-" : "-";
    document.getElementById("stat-operation").textContent = step.opMessage || "-";
    document.getElementById("stat-discovered").textContent = step.discovered ? step.discovered.size : 0;
    document.getElementById("stat-completed").textContent = step.completed ? step.completed.size : 0;
    document.getElementById("stat-traversal-order").textContent = step.traversalOrder ? step.traversalOrder.map(id => nodes.get(id)?.label).join(", ") : "-";

    // Queue or stack display depends on algorithm
    if (algorithmState.name === "Breadth-First Search (BFS)") {
      document.getElementById("stat-queue-stack").textContent = step.queue ? step.queue.map(id => nodes.get(id)?.label).join(", ") : "-";
    } else if (algorithmState.name === "Depth-First Search (DFS)") {
      document.getElementById("stat-queue-stack").textContent = step.stack ? step.stack.map(id => nodes.get(id)?.label).join(", ") : "-";
    } else {
      document.getElementById("stat-queue-stack").textContent = "-";
    }

    document.getElementById("stat-steps-completed").textContent = algorithmState.currentStepIndex + 1;
  }

  // Update graph highlight for selected node / modes
  function updateGraphHighlights() {
    svgNodeMap.forEach(({ circle }, id) => {
      if (id === selectedNodeId) {
        circle.classList.add("node-selected");
      } else {
        circle.classList.remove("node-selected");
      }
    });
  }

  /* ====== 10. Algorithm Comparison Calculations ====== */

  // Runs both algorithms, returns comparison object
  function compareAlgorithms(startNodeId) {
    if (!nodes.has(startNodeId)) return null;
    const bfsSteps = runBFS(startNodeId);
    const dfsSteps = runDFS(startNodeId);

    // Get final traversal orders
    const bfsOrder = bfsSteps.length > 0 ? bfsSteps[bfsSteps.length - 1].traversalOrder : [];
    const dfsOrder = dfsSteps.length > 0 ? dfsSteps[dfsSteps.length - 1].traversalOrder : [];

    // Determine reachability
    const totalNodes = nodes.size;
    const bfsVisited = bfsOrder.length;
    const dfsVisited = dfsOrder.length;

    return {
      bfs: {
        order: bfsOrder.map((id) => nodes.get(id)?.label),
        visitedCount: bfsVisited,
      },
      dfs: {
        order: dfsOrder.map((id) => nodes.get(id)?.label),
        visitedCount: dfsVisited,
      },
      totalNodes: totalNodes,
      timeComplexity: "O(V + E)",
      spaceComplexity: "O(V)",
      bfsDataStructure: "Queue",
      dfsDataStructure: "Stack",
    };
  }

  /* ====== 11. Event listeners and initialization ====== */

  // DOM Helper selectors
  const btnNewNode = document.getElementById("btn-new-node");
  const btnConnectMode = document.getElementById("btn-connect-mode");
  const btnDeleteMode = document.getElementById("btn-delete-mode");
  const btnLoadExample = document.getElementById("btn-load-example");
  const btnClearGraph = document.getElementById("btn-clear-graph");
  const btnUndo = document.getElementById("btn-undo");
  const selectLayout = document.getElementById("select-layout");
  const nodeRenameInput = document.getElementById("node-rename-input");
  const algorithmSelect = document.getElementById("algorithm-select");
  const startNodeSelect = document.getElementById("start-node-select");
  const btnRunAlgorithm = document.getElementById("btn-run-algorithm");
  const btnCompareAlgorithms = document.getElementById("btn-compare-algorithms");

  // Playback controls reference
  playPrevBtn;
  playPlayBtn;
  playPauseBtn;
  playNextBtn;
  playRestartBtn;
  playbackSpeedInput;

  // Handle buttons - toggle modes (only one can be active except New Node)
  btnNewNode.addEventListener("click", () => {
    mode.newNode = !mode.newNode;
    if (mode.newNode) {
      // disable others modes
      mode.connect = false;
      mode.delete = false;
      btnConnectMode.setAttribute("aria-pressed", "false");
      btnDeleteMode.setAttribute("aria-pressed", "false");
      btnNewNode.classList.add("active");
    } else {
      btnNewNode.classList.remove("active");
    }
    updatePlaybackStatus("Ready");
  });
  btnConnectMode.addEventListener("click", () => {
    mode.connect = !mode.connect;
    connectFirstNodeId = null;
    if (mode.connect) {
      mode.newNode = false;
      mode.delete = false;
      btnNewNode.classList.remove("active");
      btnDeleteMode.setAttribute("aria-pressed", "false");
      btnConnectMode.setAttribute("aria-pressed", "true");
    } else {
      btnConnectMode.setAttribute("aria-pressed", "false");
    }
    updatePlaybackStatus("Ready");
  });
  btnDeleteMode.addEventListener("click", () => {
    mode.delete = !mode.delete;
    if (mode.delete) {
      mode.newNode = false;
      mode.connect = false;
      btnNewNode.classList.remove("active");
      btnConnectMode.setAttribute("aria-pressed", "false");
      btnDeleteMode.setAttribute("aria-pressed", "true");
    } else {
      btnDeleteMode.setAttribute("aria-pressed", "false");
    }
    updatePlaybackStatus("Ready");
  });

  btnLoadExample.addEventListener("click", () => {
    if (nodes.size > 0 && !confirm("Loading example will clear current graph. Proceed?")) return;
    loadExampleGraph();
    renderGraph();
    renderInspector();
    updateAfterEdit();
    selectLayout.value = "circular";
    resetNodePositions("circular");
    renderGraph();
    showToast("Example graph loaded.");
  });
  btnClearGraph.addEventListener("click", () => {
    if (nodes.size > 0 && !confirm("Clear entire graph? This cannot be undone.")) return;
    clearGraph();
    renderGraph();
    renderInspector();
    updateAfterEdit();
    showToast("Workspace cleared.");
  });

  btnUndo.addEventListener("click", () => {
    undoLastEdit();
    renderGraph();
    renderInspector();
    updateAfterEdit();
  });

  selectLayout.addEventListener("change", () => {
    const layout = selectLayout.value;
    resetNodePositions(layout);
    renderGraph();
    renderInspector();
  });

  // Rename node on Enter key
  nodeRenameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const newName = nodeRenameInput.value.trim();
      if (!newName) {
        showToast("Node label cannot be empty.");
        return;
      }
      if (!selectedNodeId) {
        showToast("No node selected.");
        return;
      }
      if (renameNode(selectedNodeId, newName)) {
        renderGraph();
        renderInspector();
        showToast(`Node renamed to ${newName}.`);
        updateAfterEdit();
      } else {
        showToast("Rename failed or duplicate label.");
      }
    }
  });

  // Algorithm selection changes update UI
  algorithmSelect.addEventListener("change", () => {
    updatePlaybackStatus("Ready");
  });

  // Start node select changes update playback status
  startNodeSelect.addEventListener("change", () => {
    updatePlaybackStatus("Ready");
  });

  // Run algorithm button
  btnRunAlgorithm.addEventListener("click", () => {
    const algo = algorithmSelect.value;
    const startNode = startNodeSelect.value;
    if (!startNode || !nodes.has(startNode)) {
      showToast("Please select a valid start node.");
      return;
    }
    if (algo === "bfs") {
      algorithmState.steps = runBFS(startNode);
      algorithmState.name = "Breadth-First Search (BFS)";
    } else if (algo === "dfs") {
      algorithmState.steps = runDFS(startNode);
      algorithmState.name = "Depth-First Search (DFS)";
    }
    if (algorithmState.steps.length === 0) {
      showToast("Traversal failed. Check graph and start node.");
      return;
    }
    algorithmState.currentStepIndex = 0;
    algorithmState.traversalValid = true;
    algorithmState.lastStartNodeId = startNode;
    pausePlayback();
    playPlayBtn.disabled = false;
    goToStep(0);
    updatePlaybackStatus("Ready");
  });

  // Playback buttons handlers
  playPrevBtn.addEventListener("click", () => {
    pausePlayback();
    prevStep();
  });
  playPlayBtn.addEventListener("click", () => {
    playTraversal();
  });
  playPauseBtn.addEventListener("click", () => {
    pausePlayback();
  });
  playNextBtn.addEventListener("click", () => {
    pausePlayback();
    nextStep();
  });
  playRestartBtn.addEventListener("click", () => {
    restartTraversal();
  });
  playbackSpeedInput.addEventListener("input", () => {
    updatePlaybackSpeed(parseInt(playbackSpeedInput.value, 10));
  });

  // Compare BFS and DFS button
  btnCompareAlgorithms.addEventListener("click", () => {
    const startNode = startNodeSelect.value;
    if (!startNode || !nodes.has(startNode)) {
      showToast("Please select a valid start node for comparison.");
      return;
    }
    const comparison = compareAlgorithms(startNode);
    if (!comparison) {
      showToast("Comparison unavailable.");
      return;
    }
    showComparisonDialog(comparison);
  });

  // Populate start node select dropdown
  function populateStartNodeSelect() {
    // Save current selection
    const current = startNodeSelect.value;
    startNodeSelect.innerHTML = "";
    nodes.forEach(({ id, label }) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = label;
      startNodeSelect.appendChild(option);
    });
    if (current && nodes.has(current)) {
      startNodeSelect.value = current;
    } else if (nodes.size > 0) {
      startNodeSelect.value = nodes.keys().next().value;
    }
  }

  // Toast / Status message system
  let toastTimeoutId = null;
  function showToast(msg, duration = 2500) {
    let toast = document.getElementById("toast-msg");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "toast-msg";
      toast.setAttribute("role", "alert");
      toast.style.cssText =
        "position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);" +
        "background: #3b2e96cc; color: white; padding: 10px 20px; border-radius: 20px;" +
        "box-shadow: 0 0 12px #7d6cffaa; font-weight: 700; z-index: 1000;";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = "1";
    if (toastTimeoutId) clearTimeout(toastTimeoutId);
    toastTimeoutId = setTimeout(() => {
      toast.style.opacity = "0";
    }, duration);
  }

  // Show algorithm comparison dialog
  function showComparisonDialog(comparison) {
    const dialogDiv = document.createElement("div");
    dialogDiv.style.cssText =
      "position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);" +
      "background: #1e1e33; color: #b0b0cc; padding: 20px; border-radius: 14px; " +
      "box-shadow: 0 0 20px violet; max-width: 400px; font-size: 0.9rem; z-index: 1100;" +
      "max-height: 90vh; overflow-y: auto;";

    dialogDiv.innerHTML = `
      <h2 style="color:violet; margin-top:0;">Algorithm Comparison</h2>
      <p><strong>Total Nodes:</strong> ${comparison.totalNodes}</p>
      <p><strong>BFS Traversal Order:</strong> ${comparison.bfs.order.join(", ") || "None"}</p>
      <p><strong>BFS Visited Nodes:</strong> ${comparison.bfs.visitedCount}</p>
      <p><strong>DFS Traversal Order:</strong> ${comparison.dfs.order.join(", ") || "None"}</p>
      <p><strong>DFS Visited Nodes:</strong> ${comparison.dfs.visitedCount}</p>
      <table style="width:100%;border-collapse:collapse; margin-top:10px;">
        <thead>
          <tr><th style="border:1px solid #444; padding:6px;">Aspect</th><th style="border:1px solid #444; padding:6px;">BFS</th><th style="border:1px solid #444; padding:6px;">DFS</th></tr>
        </thead>
        <tbody>
          <tr><td style="border:1px solid #444; padding:6px;">Time Complexity</td><td style="border:1px solid #444; padding:6px;">${comparison.timeComplexity}</td><td style="border:1px solid #444; padding:6px;">${comparison.timeComplexity}</td></tr>
          <tr><td style="border:1px solid #444; padding:6px;">Auxiliary Space</td><td style="border:1px solid #444; padding:6px;">${comparison.spaceComplexity}</td><td style="border:1px solid #444; padding:6px;">${comparison.spaceComplexity}</td></tr>
          <tr><td style="border:1px solid #444; padding:6px;">Data Structure</td><td style="border:1px solid #444; padding:6px;">${comparison.bfsDataStructure}</td><td style="border:1px solid #444; padding:6px;">${comparison.dfsDataStructure}</td></tr>
        </tbody>
      </table>
      <p style="margin-top:12px; font-size:0.85rem; color:#aaa;">
        BFS is useful for shortest path in unweighted graphs.<br>
        DFS excels in connectivity and backtracking problems.<br>
        Neither is always faster; choice depends on problem context.
      </p>
      <button id="btn-close-comparison" style="margin-top:10px; padding:6px 12px; border-radius:8px; background: violet; border:none; color:#fff; font-weight:700; cursor:pointer;">Close</button>
    `;

    // Create overlay
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;" +
      "background: rgba(0,0,0,0.75); z-index: 1000;";

    document.body.appendChild(overlay);
    document.body.appendChild(dialogDiv);

    document.getElementById("btn-close-comparison").addEventListener("click", () => {
      document.body.removeChild(dialogDiv);
      document.body.removeChild(overlay);
    });

    overlay.addEventListener("click", () => {
      document.body.removeChild(dialogDiv);
      document.body.removeChild(overlay);
    });
  }

  // Initialize page on load
  function init() {
    populateStartNodeSelect();
    renderGraph();
    renderInspector();
    updateUndoButton();
    updatePlaybackStatus("Ready");
  }

  /* ====== Exposed API for init and update ====== */
  return {
    addNode,
    deleteNode,
    addEdge,
    deleteEdge,
    renameNode,
    selectNode,
    getSelectedNode: () => selectedNodeId,
    runBFS,
    runDFS,
    resetNodePositions,
    invalidateTraversal,
    renderGraph,
    renderInspector,
    updateUndoButton,
    updatePlaybackStatus,
    updateGraphHighlights,
    updateAfterEdit,
    algorithmState,
    playback,
    init,
  };
})();

/* Module instance */
(function () {
  // From GraphLab namespace
  const GL = GraphLab;

  // Initialize on DOM Ready
  window.addEventListener("load", () => {
    GL.init();
  });
})();