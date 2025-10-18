import React, { useState, useRef, useEffect } from 'react';
import { Camera, Upload, Trash2, DollarSign, TrendingUp, MessageSquare, Send, FileText } from 'lucide-react';
import Tesseract from 'tesseract.js';

const ExpenseTrackerApp = () => {
  const [bills, setBills] = useState([]);
  const [activeTab, setActiveTab] = useState('scanner');
  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [chatMessages, setChatMessages] = useState([]);
  const [userMessage, setUserMessage] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualBill, setManualBill] = useState({
    organization: '',
    amount: '',
    tip: '',
  });
  const [apiKey, setApiKey] = useState('');
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [useOCR, setUseOCR] = useState(true);
  const [isInitializingOCR, setIsInitializingOCR] = useState(false);
  const [skipPreprocessing, setSkipPreprocessing] = useState(false);
  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);

  useEffect(() => {
    const savedKey = localStorage.getItem('openaiApiKey');
    if (savedKey) {
      setApiKey(savedKey);
    }
  }, []);

  // Preload Tesseract.js for better user experience
  useEffect(() => {
    if (useOCR && typeof Tesseract !== 'undefined') {
      console.log('Preloading Tesseract.js...');
      // Preload the worker to avoid initialization delay
      Tesseract.createWorker('eng').then(worker => {
        console.log('Tesseract worker preloaded successfully');
        worker.terminate(); // Clean up the preloaded worker
      }).catch(error => {
        console.warn('Failed to preload Tesseract worker:', error);
      });
    }
  }, [useOCR]);

  useEffect(() => {
    const saved = localStorage.getItem('expenseBills');
    if (saved) {
      setBills(JSON.parse(saved));
    }
  }, []);

  useEffect(() => {
    if (bills.length > 0) {
      localStorage.setItem('expenseBills', JSON.stringify(bills));
    }
  }, [bills]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const openAIChatCompletion = async ({ apiKey, messages, model = 'gpt-4o-mini', temperature = 0.2 }) => {
    const url = 'https://api.openai.com/v1/chat/completions';
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };
    const body = JSON.stringify({ model, messages, temperature });
    const resp = await fetch(url, { method: 'POST', headers, body });
    const data = await resp.json();
    if (data.error) {
      throw new Error(data.error.message || 'OpenAI API request failed');
    }
    const content = data.choices?.[0]?.message?.content || '';
    return content;
  };

  // Advanced receipt text parsing function for OCR
  const parseReceiptText = (text) => {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    let organization = 'Unknown';
    let amount = 0;
    let tip = 0;

    console.log('Parsing receipt text:', lines);

    // Extract organization name - look for restaurant/business names
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      const line = lines[i];
      // Look for business name patterns - be more specific
      if (line.length >= 3 && line.length <= 60 && 
          !line.match(/^\d/) && 
          !line.toLowerCase().match(/receipt|invoice|bill|tax|total|subtotal|payment|date|time|card|cash|address|phone|gst|particulars|qty|rate|amount|sub|dis|net|cgst|sgst|grand|thank|visit|service|take|away|counter|boy|no|type|mumbai|compound|chowk|building|bldg|muncipal|joban|putra/)) {
        if (line.match(/[a-zA-Z]{3,}/)) {
          // Clean up the organization name
          let cleanName = line.replace(/[^a-zA-Z0-9\s&'-]/g, '').trim();
          
          // Look for patterns like "SRI KRISHNA" or "RESTAURANT NAME"
          if (cleanName.match(/^[A-Z\s]{3,}$/) || cleanName.match(/[A-Z]{2,}/)) {
            organization = cleanName;
            console.log('Found organization name:', organization, 'from line:', line);
            break;
          }
        }
      }
    }

    // Extract tip with multiple patterns (more flexible)
    const tipPatterns = [
      /tip[\s:]*\$?\s*(\d+)[.,](\d{2})/i,
      /tip[\s:]*\$?\s*(\d+)\.(\d{2})/i,
      /gratuity[\s:]*\$?\s*(\d+)[.,](\d{2})/i,
      /service[\s:]*\$?\s*(\d+)[.,](\d{2})/i,
    ];

    for (const line of lines) {
      for (const pattern of tipPatterns) {
        const match = line.match(pattern);
        if (match) {
          const value = parseFloat(`${match[1]}.${match[2]}`);
          if (value > 0 && value < 1000) {
            tip = value;
            console.log('Found tip:', tip, 'from line:', line);
            break;
          }
        }
      }
      if (tip > 0) break;
    }

    // Extract total amount with enhanced patterns - prioritize Grand Total
    const totalPatterns = [
      /grand\s*total[\s:]*\$?\s*(\d+)[.,]?(\d{0,2})/i,  // Grand Total (highest priority)
      /grand\s*total[\s:]*\s*(\d+)[.,]?(\d{0,2})/i,     // Grand Total without $ symbol
      /total[\s:]*\$?\s*(\d+)[.,]?(\d{0,2})/i,         // Total
      /total[\s:]*\s*(\d+)[.,]?(\d{0,2})/i,            // Total without $ symbol
      /amount\s*due[\s:]*\$?\s*(\d+)[.,]?(\d{0,2})/i,  // Amount Due
      /balance[\s:]*\$?\s*(\d+)[.,]?(\d{0,2})/i,       // Balance
      /amount[\s:]*\$?\s*(\d+)[.,]?(\d{0,2})/i,        // Amount
      /total\s*amount[\s:]*\$?\s*(\d+)[.,]?(\d{0,2})/i, // Total Amount
      /net\s*total[\s:]*\$?\s*(\d+)[.,]?(\d{0,2})/i,   // Net Total
      /final\s*amount[\s:]*\$?\s*(\d+)[.,]?(\d{0,2})/i, // Final Amount
    ];

    // First, try to find Grand Total with very specific patterns
    for (const line of lines) {
      // Look for "Grand Total: 70" pattern specifically
      const grandTotalMatch = line.match(/grand\s*total[\s:]*(\d+)/i);
      if (grandTotalMatch) {
        amount = parseFloat(grandTotalMatch[1]);
        console.log('Found Grand Total amount:', amount, 'from line:', line);
        break;
      }
      
      // Also try to find just "Grand Total" followed by a number on the same line or next line
      if (line.toLowerCase().includes('grand total')) {
        const numberMatch = line.match(/(\d+)/);
        if (numberMatch) {
          amount = parseFloat(numberMatch[1]);
          console.log('Found Grand Total amount (alternative):', amount, 'from line:', line);
          break;
        }
      }
    }

    // If Grand Total not found, try other patterns
    if (amount === 0) {
      for (const line of lines) {
        for (const pattern of totalPatterns) {
          const match = line.match(pattern);
          if (match) {
            let value;
            if (match[2] && match[2].length > 0) {
              // Has decimal part
              const decimalPart = match[2].length === 1 ? match[2] + '0' : match[2];
              value = parseFloat(`${match[1]}.${decimalPart}`);
            } else {
              // No decimal part, treat as whole number
              value = parseFloat(match[1]);
            }
            
            if (value > 0 && value < 10000) {
              amount = value;
              console.log('Found amount:', amount, 'from line:', line);
              break;
            }
          }
        }
        if (amount > 0) break;
      }
    }

    // Enhanced fallback: find all currency amounts with proper decimal handling
    if (amount === 0) {
      const amounts = [];
      // More flexible currency patterns - handle both . and , as decimal separator
      const currencyPatterns = [
        /\$\s*(\d+)[.,](\d{2})\b/g,
        /\b(\d+)[.,](\d{2})\b/g,
        /\$\s*(\d+)[.,](\d{1})\b/g, // Handle single decimal digit
        /\b(\d+)\b/g, // Whole numbers
      ];
      
      for (const line of lines) {
        // Skip lines that are clearly not totals (but allow "total" keywords)
        if (line.toLowerCase().match(/tax|subtotal|discount|change|item|sold|particulars|qty|rate|amount|sub|dis|net|cgst|sgst|thank|visit|service|take|away|counter|boy|no|type|address|phone|gst/) && 
            !line.toLowerCase().match(/total|grand|final|balance|due/)) continue;
        
        for (const pattern of currencyPatterns) {
          let match;
          pattern.lastIndex = 0; // Reset regex
          while ((match = pattern.exec(line)) !== null) {
            let value;
            if (match[2] && match[2].length > 0) {
              // Has decimal part
              const decimalPart = match[2].length === 1 ? match[2] + '0' : match[2];
              value = parseFloat(`${match[1]}.${decimalPart}`);
            } else {
              value = parseFloat(match[1]);
            }
            
            if (value > 0 && value < 10000) {
              // Give higher priority to lines containing "total" keywords
              const priority = line.toLowerCase().match(/total|grand|final|balance|due/) ? 1 : 0;
              amounts.push({ value, line, priority });
              console.log('Found potential amount:', value, 'from:', line, 'priority:', priority);
            }
          }
        }
      }
      
      if (amounts.length > 0) {
        // Sort by priority first, then by value
        amounts.sort((a, b) => {
          if (a.priority !== b.priority) return b.priority - a.priority;
          return b.value - a.value;
        });
        
        amount = amounts[0].value;
        console.log('Found amount from fallback:', amount, 'from line:', amounts[0].line);
      }
    }

    // If still no amount, try even more aggressive pattern matching
    if (amount === 0) {
      console.log('Trying aggressive decimal matching...');
      for (const line of lines) {
        // Match any number followed by decimal point or period or comma and two digits
        const matches = line.match(/(\d+)\s*[.,]\s*(\d{2})/g);
        if (matches && matches.length > 0) {
          console.log('Aggressive match found in line:', line, 'matches:', matches);
          for (const match of matches) {
            const cleaned = match.replace(/\s/g, '').replace(',', '.');
            const value = parseFloat(cleaned);
            if (value > 0 && value < 10000) {
              if (value > amount) {
                amount = value;
                console.log('Updated amount to:', amount);
              }
            }
          }
        }
      }
    }

    // Clean up organization name
    organization = organization.replace(/[^a-zA-Z0-9\s&'-]/g, '').trim();
    organization = organization.replace(/\s+/g, ' '); // Remove extra spaces
    
    // Remove common suffixes that aren't part of the business name
    organization = organization.replace(/\s+(restaurant|hotel|cafe|bar|grill|kitchen|food|center|centre|store|shop|market|plaza|mall|complex|building|bldg|veg|non-veg|pure|veg|pure veg)$/i, '');
    
    if (organization.length > 50) {
      organization = organization.substring(0, 50);
    }
    if (!organization || organization.length < 2) {
      // Try one more time to find any text-heavy line
      const textLine = lines.find(l => l.match(/[a-zA-Z]{5,}/) && l.length >= 4 && l.length <= 50);
      if (textLine) {
        organization = textLine.replace(/[^a-zA-Z0-9\s&'-]/g, '').trim();
        organization = organization.replace(/\s+(restaurant|hotel|cafe|bar|grill|kitchen|food|center|centre|store|shop|market|plaza|mall|complex|building|bldg|veg|non-veg|pure|veg|pure veg)$/i, '');
      } else {
        organization = 'Unknown Business';
      }
    }

    console.log('Final parsed data:', { organization, amount, tip });
    console.log('Raw extracted text for debugging:', text);

    return {
      organization: organization,
      amount: amount || 0,
      tip: tip || 0,
    };
  };

  const processImageWithOCR = async (file) => {
    console.log('Starting OCR processing for file:', file.name, 'Size:', file.size, 'Type:', file.type);
    setIsProcessing(true);
    setOcrProgress(0);

    // Set a timeout to prevent infinite hanging
    const timeoutId = setTimeout(() => {
      console.error('OCR processing timeout after 60 seconds');
      setIsProcessing(false);
      setOcrProgress(0);
      alert('Image processing timed out. Please try with a smaller image or different format.');
    }, 60000); // 60 seconds timeout

    try {
      const reader = new FileReader();
      let imageData = null; // Declare imageData in the outer scope
      
      reader.onload = async (e) => {
        try {
          console.log('FileReader loaded, starting image processing...');
          imageData = e.target.result; // Assign to the outer scope variable
          console.log('Image data length:', imageData.length);

          // Preprocess image for better OCR accuracy (with fallback and timeout)
          let preprocessedImage;
          if (skipPreprocessing) {
            console.log('Skipping image preprocessing as requested');
            preprocessedImage = imageData;
          } else {
            console.log('Starting image preprocessing...');
            try {
              // Add timeout for preprocessing
              const preprocessPromise = preprocessImage(imageData);
              const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Preprocessing timeout')), 10000)
              );
              
              preprocessedImage = await Promise.race([preprocessPromise, timeoutPromise]);
              console.log('Image preprocessing completed');
            } catch (preprocessError) {
              console.warn('Image preprocessing failed, using original image:', preprocessError);
              preprocessedImage = imageData; // Use original image as fallback
            }
          }

          // Check if Tesseract is available
          if (typeof Tesseract === 'undefined') {
            throw new Error('Tesseract.js is not loaded. This might be due to network issues or browser compatibility. Please refresh the page and try again, or switch to AI mode.');
          }

          // Use Tesseract.js with optimized settings
          console.log('Starting Tesseract OCR...');
          setIsInitializingOCR(true);
          const result = await Tesseract.recognize(preprocessedImage, 'eng', {
            logger: (m) => {
              console.log('Tesseract progress:', m);
              if (m.status === 'loading tesseract core') {
                setIsInitializingOCR(true);
              } else if (m.status === 'initializing tesseract') {
                setIsInitializingOCR(true);
              } else if (m.status === 'recognizing text') {
                setIsInitializingOCR(false);
                setOcrProgress(Math.round(m.progress * 100));
              }
            },
            // Enhanced Tesseract configurations
            tessedit_pageseg_mode: Tesseract.PSM.AUTO,
            tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz$.,:-& ',
          });
          setIsInitializingOCR(false);

          console.log('OCR completed successfully');
          const extractedText = result.data.text;
          console.log('Extracted Text:', extractedText);
          console.log('Confidence:', result.data.confidence);
          
          // Smart parsing of the extracted text
          const billData = parseReceiptText(extractedText);

          const newBill = {
            id: Date.now(),
            date: new Date().toISOString(),
            image: imageData,
            organization: billData.organization,
            amount: billData.amount,
            tip: billData.tip,
            rawText: extractedText,
            confidence: result.data.confidence,
          };

          setBills(prev => [newBill, ...prev]);
          setIsProcessing(false);
          setOcrProgress(0);
          clearTimeout(timeoutId);
          console.log('Bill added successfully:', newBill);
        } catch (innerError) {
          console.error('Error in FileReader onload:', innerError);
          setIsProcessing(false);
          setOcrProgress(0);
          clearTimeout(timeoutId);
          
          // Offer fallback to manual entry
          const shouldFallback = window.confirm(
            'OCR processing failed: ' + innerError.message + 
            '\n\nWould you like to add this expense manually instead?'
          );
          
          if (shouldFallback && imageData) {
            // Create a bill with just the image and let user fill in details
            const fallbackBill = {
              id: Date.now(),
              date: new Date().toISOString(),
              image: imageData,
              organization: 'Unknown (OCR Failed)',
              amount: 0,
              tip: 0,
              isOcrFailed: true,
            };
            setBills(prev => [fallbackBill, ...prev]);
          }
        }
      };

      reader.onerror = (error) => {
        console.error('FileReader error:', error);
        setIsProcessing(false);
        setOcrProgress(0);
        clearTimeout(timeoutId);
        alert('Error reading file: ' + error.message);
      };

      console.log('Starting FileReader...');
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('OCR Error:', error);
      setIsProcessing(false);
      setOcrProgress(0);
      clearTimeout(timeoutId);
      alert('Error processing image with OCR: ' + error.message);
    }
  };

  // Simplified image preprocessing to prevent blocking
  const preprocessImage = (imageData) => {
    return new Promise((resolve, reject) => {
      console.log('Starting simplified image preprocessing...');
      const img = new Image();
      
      img.onload = () => {
        try {
          console.log('Image loaded, dimensions:', img.width, 'x', img.height);
          
          // Skip preprocessing for very large images to prevent blocking
          if (img.width > 2000 || img.height > 2000) {
            console.log('Image too large, skipping preprocessing to prevent blocking');
            resolve(imageData);
            return;
          }
          
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          if (!ctx) {
            throw new Error('Could not get canvas context');
          }
          
          // Use smaller scale to reduce processing time
          const scale = 1.5; // Further reduced from 2 to 1.5
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;
          
          console.log('Canvas dimensions:', canvas.width, 'x', canvas.height);
          
          // Draw image with scaling
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          
          // Apply simple filters instead of complex processing
          ctx.filter = 'contrast(1.1) brightness(1.05)';
          ctx.drawImage(canvas, 0, 0);
          
          const result = canvas.toDataURL();
          console.log('Image preprocessing completed successfully');
          resolve(result);
        } catch (error) {
          console.error('Error in image preprocessing:', error);
          reject(error);
        }
      };
      
      img.onerror = (error) => {
        console.error('Error loading image:', error);
        reject(new Error('Failed to load image for preprocessing'));
      };
      
      img.src = imageData;
    });
  };

  const processImageWithAI = async (file) => {
    if (!apiKey) {
      setShowApiKeyInput(true);
      alert('Please enter your OpenAI API key first');
      return;
    }

    setIsProcessing(true);

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const imageData = e.target.result;
        const base64Data = imageData.split(',')[1];

        const messages = [
          {
            role: 'system',
            content: 'You extract fields from receipts. Respond ONLY with compact JSON: {"organization":"string","amount":number,"tip":number}',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyze this bill/receipt image and extract the fields. Respond ONLY with JSON.' },
              { type: 'image_url', image_url: { url: `data:${file.type};base64,${base64Data}` } },
            ],
          },
        ];

        let responseText = await openAIChatCompletion({ apiKey, messages, model: 'gpt-4o-mini' });
        responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        
        const billData = JSON.parse(responseText);

        const newBill = {
          id: Date.now(),
          date: new Date().toISOString(),
          image: imageData,
          organization: billData.organization || 'Unknown',
          amount: billData.amount || 0,
          tip: billData.tip || 0,
        };

        setBills(prev => [newBill, ...prev]);
        setIsProcessing(false);
      };

      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Processing Error:', error);
      setIsProcessing(false);
      alert('Error processing image: ' + error.message);
    }
  };

  const processImage = async (file) => {
    if (useOCR) {
      await processImageWithOCR(file);
    } else {
      await processImageWithAI(file);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    console.log('File selected:', file);
    
    if (!file) {
      console.log('No file selected');
      return;
    }
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file (JPG, PNG, GIF, etc.)');
      return;
    }
    
    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      alert('File size too large. Please select an image smaller than 10MB.');
      return;
    }
    
    // Validate file size (min 1KB)
    if (file.size < 1024) {
      alert('File size too small. Please select a valid image file.');
      return;
    }
    
    console.log('File validation passed, starting processing...');
    processImage(file);
  };

  const deleteBill = (id) => {
    setBills(prev => prev.filter(bill => bill.id !== id));
  };

  const addManualBill = () => {
    if (!manualBill.organization || !manualBill.amount) {
      alert('Please fill in at least the organization name and amount.');
      return;
    }

    const newBill = {
      id: Date.now(),
      date: new Date().toISOString(),
      image: null,
      organization: manualBill.organization,
      amount: parseFloat(manualBill.amount) || 0,
      tip: parseFloat(manualBill.tip) || 0,
      isManual: true,
    };

    setBills(prev => [newBill, ...prev]);
    setManualBill({ organization: '', amount: '', tip: '' });
    setShowManualEntry(false);
  };

  const updateBill = (id, field, value) => {
    setBills(prev => prev.map(bill => 
      bill.id === id ? { ...bill, [field]: value } : bill
    ));
  };

  const getTotalExpenses = () => {
    return bills.reduce((sum, bill) => sum + (bill.amount || 0), 0);
  };

  const getTotalTips = () => {
    return bills.reduce((sum, bill) => sum + (bill.tip || 0), 0);
  };

  const sendChatMessage = async () => {
    if (!userMessage.trim()) return;

    if (!apiKey) {
      setShowApiKeyInput(true);
      alert('Please enter your OpenAI API key first');
      return;
    }

    const newUserMessage = { role: 'user', content: userMessage };
    setChatMessages(prev => [...prev, newUserMessage]);
    setUserMessage('');
    setIsChatLoading(true);

    try {
      const billsSummary = bills.map(b => ({
        date: new Date(b.date).toLocaleDateString(),
        org: b.organization,
        amount: b.amount,
        tip: b.tip,
      }));

      const systemContext = `You are an expense tracking assistant. User has ${bills.length} bills: ${JSON.stringify(billsSummary)}. Total: $${getTotalExpenses().toFixed(2)}, Tips: $${getTotalTips().toFixed(2)}`;

      const messages = [
        { role: 'system', content: systemContext },
        ...chatMessages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
        { role: 'user', content: userMessage },
      ];

      const content = await openAIChatCompletion({ apiKey, messages, model: 'gpt-4o-mini' });

      const assistantMessage = { role: 'assistant', content };

      setChatMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Chat error:', error);
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Error: ' + error.message,
      }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="bg-indigo-600 p-2 rounded-lg">
                <FileText className="text-white" size={24} />
              </div>
              <h1 className="text-2xl font-bold text-gray-800">Smart Expense Tracker</h1>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setShowApiKeyInput(!showApiKeyInput)}
                className="text-sm text-indigo-600 hover:text-indigo-800"
              >
                {apiKey ? '🔑 API Key Set' : '⚙️ Setup API Key'}
              </button>
              <div className="text-right">
                <p className="text-sm text-gray-500">Total Expenses</p>
                <p className="text-2xl font-bold text-indigo-600">${getTotalExpenses().toFixed(2)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* API Key Input Modal */}
      {showApiKeyInput && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-8 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Enter OpenAI API Key</h3>
            <p className="text-sm text-gray-600 mb-4">
              Create or manage your key at: <a href="https://platform.openai.com/account/api-keys" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">OpenAI Platform</a>
            </p>
            <p className="text-xs text-gray-500 mb-4">
              Note: API key is only needed for AI chat assistant. OCR bill scanning works offline with Tesseract.js (no API needed).
            </p>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your OpenAI API key"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent mb-4"
            />
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  if (apiKey) {
                    localStorage.setItem('openaiApiKey', apiKey);
                    setShowApiKeyInput(false);
                  } else {
                    alert('Please enter an API key');
                  }
                }}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-lg"
              >
                Save Key
              </button>
              <button
                onClick={() => setShowApiKeyInput(false)}
                className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium py-2 px-4 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* How It Works Guide Modal */}
      {showGuide && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-indigo-600 to-purple-600 text-white p-6 rounded-t-2xl">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">✨ Smart Expense Tracker Guide</h2>
                <button
                  onClick={() => setShowGuide(false)}
                  className="text-white hover:bg-white hover:bg-opacity-20 rounded-full p-2 transition-all"
                >
                  ✕
                </button>
              </div>
              <p className="text-indigo-100 mt-2">Your AI-powered financial companion</p>
            </div>

            <div className="p-6 space-y-6">
              <div>
                <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center">
                  <span className="bg-indigo-100 text-indigo-600 rounded-full w-8 h-8 flex items-center justify-center mr-3">🎯</span>
                  Key Features
                </h3>
                <div className="space-y-4">
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg border-l-4 border-indigo-500">
                    <h4 className="font-semibold text-gray-800 mb-2">📸 Offline OCR Bill Scanner</h4>
                    <p className="text-gray-600 text-sm">Snap a photo and Tesseract.js OCR extracts data completely offline! Switch to AI mode for even more accuracy (requires API key).</p>
                  </div>
                  
                  <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-4 rounded-lg border-l-4 border-green-500">
                    <h4 className="font-semibold text-gray-800 mb-2">✍️ Manual Entry</h4>
                    <p className="text-gray-600 text-sm">Lost your receipt? No problem! Quickly add expenses manually.</p>
                  </div>
                  
                  <div className="bg-gradient-to-r from-purple-50 to-pink-50 p-4 rounded-lg border-l-4 border-purple-500">
                    <h4 className="font-semibold text-gray-800 mb-2">📊 Real-Time Tracking</h4>
                    <p className="text-gray-600 text-sm">Beautiful gauge meter updates instantly with color-coded zones.</p>
                  </div>
                  
                  <div className="bg-gradient-to-r from-orange-50 to-amber-50 p-4 rounded-lg border-l-4 border-orange-500">
                    <h4 className="font-semibold text-gray-800 mb-2">🤖 AI Assistant</h4>
                    <p className="text-gray-600 text-sm">Chat with your personal expense advisor powered by OpenAI!</p>
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white p-6 rounded-xl">
                <h3 className="text-xl font-bold mb-3">🚀 Quick Start Guide</h3>
                <ol className="space-y-2 text-sm">
                  <li className="flex items-start">
                    <span className="bg-white text-indigo-600 rounded-full w-6 h-6 flex items-center justify-center mr-3 flex-shrink-0 font-bold">1</span>
                    <span>Upload a bill - OCR works offline, no setup needed!</span>
                  </li>
                  <li className="flex items-start">
                    <span className="bg-white text-indigo-600 rounded-full w-6 h-6 flex items-center justify-center mr-3 flex-shrink-0 font-bold">2</span>
                    <span>(Optional) Add OpenAI API key for AI chat assistant</span>
                  </li>
                  <li className="flex items-start">
                    <span className="bg-white text-indigo-600 rounded-full w-6 h-6 flex items-center justify-center mr-3 flex-shrink-0 font-bold">3</span>
                    <span>Check "Expense Tracker" for spending meter</span>
                  </li>
                  <li className="flex items-start">
                    <span className="bg-white text-indigo-600 rounded-full w-6 h-6 flex items-center justify-center mr-3 flex-shrink-0 font-bold">4</span>
                    <span>Chat with AI Assistant for insights</span>
                  </li>
                </ol>
              </div>

              <button
                onClick={() => setShowGuide(false)}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold py-3 px-6 rounded-lg transition-all duration-200 shadow-md hover:shadow-lg"
              >
                Got It! Let's Start Tracking 🎉
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 mt-6">
        <div className="flex items-center justify-between">
          <div className="flex space-x-2 border-b border-gray-200">
            <button
              onClick={() => setActiveTab('scanner')}
              className={`px-6 py-3 font-medium transition-colors ${
                activeTab === 'scanner'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Camera size={18} />
                <span>Bill Scanner</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('expenses')}
              className={`px-6 py-3 font-medium transition-colors ${
                activeTab === 'expenses'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <div className="flex items-center space-x-2">
                <TrendingUp size={18} />
                <span>Expense Tracker</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('assistant')}
              className={`px-6 py-3 font-medium transition-colors ${
                activeTab === 'assistant'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <div className="flex items-center space-x-2">
                <MessageSquare size={18} />
                <span>AI Assistant</span>
              </div>
            </button>
          </div>
          <button
            onClick={() => setShowGuide(true)}
            className="px-6 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-medium rounded-lg shadow-md hover:shadow-lg transition-all duration-200 flex items-center space-x-2"
          >
            <span>✨</span>
            <span>How It Works</span>
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {activeTab === 'scanner' && (
          <div>
            <div className="bg-white rounded-xl shadow-md p-8 mb-6">
              <h2 className="text-xl font-semibold mb-4 text-gray-800">Add Expense</h2>
              
              {/* OCR Mode Toggle */}
              <div className="mb-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-indigo-200">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-800 mb-1">Scan Mode</h3>
                    <p className="text-sm text-gray-600">
                      {useOCR ? '🔬 Offline OCR (Tesseract.js) - No API needed!' : '🤖 AI Vision (OpenAI) - More accurate'}
                    </p>
                    {useOCR && (
                      <div className="mt-2">
                        <p className="text-xs text-gray-500">
                          Status: {typeof Tesseract !== 'undefined' ? '✅ Ready' : '⏳ Loading...'}
                        </p>
                        <label className="flex items-center mt-1 text-xs text-gray-600">
                          <input
                            type="checkbox"
                            checked={skipPreprocessing}
                            onChange={(e) => setSkipPreprocessing(e.target.checked)}
                            className="mr-2"
                          />
                          Skip image preprocessing (if getting stuck)
                        </label>
                      </div>
                    )}
                  </div>
                  <div className="flex space-x-2">
                    {useOCR && (
                      <button
                        onClick={() => {
                          if (typeof Tesseract !== 'undefined') {
                            alert('Tesseract.js is loaded and ready!');
                          } else {
                            alert('Tesseract.js is still loading. Please wait a moment and try again.');
                          }
                        }}
                        className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
                      >
                        Test OCR
                      </button>
                    )}
                    <button
                      onClick={() => setUseOCR(!useOCR)}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      Switch to {useOCR ? 'AI' : 'OCR'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex space-x-4 mb-6">
                <button
                  onClick={() => setShowManualEntry(false)}
                  className={`flex-1 py-3 px-4 rounded-lg font-medium transition-colors ${
                    !showManualEntry
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  Scan Bill
                </button>
                <button
                  onClick={() => setShowManualEntry(true)}
                  className={`flex-1 py-3 px-4 rounded-lg font-medium transition-colors ${
                    showManualEntry
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  Manual Entry
                </button>
              </div>

              {!showManualEntry ? (
                <div>
                  <p className="text-sm text-gray-600 mb-4">
                    {useOCR 
                      ? 'Upload a receipt - Tesseract OCR will extract details offline! If it gets stuck, try refreshing the page or switching to AI mode.' 
                      : 'Upload a receipt - OpenAI will analyze it (API key required).'}
                  </p>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept="image/*"
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isProcessing}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-medium py-4 px-6 rounded-lg transition-colors flex items-center justify-center space-x-2"
                  >
                    <Upload size={20} />
                    <span>{isProcessing ? (useOCR ? 'Processing with OCR...' : 'Processing with AI...') : 'Upload Bill Image'}</span>
                  </button>
                  {isProcessing && useOCR && (
                    <div className="mt-4">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${isInitializingOCR ? 50 : ocrProgress}%` }}
                        ></div>
                      </div>
                      <p className="text-center text-sm text-gray-600 mt-2">
                        {isInitializingOCR 
                          ? 'Initializing Tesseract OCR... (This may take a moment on first use)'
                          : `OCR Processing: ${ocrProgress}% - Extracting text with Tesseract...`
                        }
                      </p>
                    </div>
                  )}
                  {isProcessing && !useOCR && (
                    <div className="mt-4">
                      <div className="flex justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                      </div>
                      <p className="text-center text-sm text-gray-600 mt-2">Analyzing with OpenAI...</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Organization *
                    </label>
                    <input
                      type="text"
                      value={manualBill.organization}
                      onChange={(e) => setManualBill(prev => ({ ...prev, organization: e.target.value }))}
                      placeholder="e.g., Starbucks"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Amount *
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={manualBill.amount}
                        onChange={(e) => setManualBill(prev => ({ ...prev, amount: e.target.value }))}
                        placeholder="0.00"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Tip
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={manualBill.tip}
                        onChange={(e) => setManualBill(prev => ({ ...prev, tip: e.target.value }))}
                        placeholder="0.00"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                  <button
                    onClick={addManualBill}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-4 px-6 rounded-lg transition-colors"
                  >
                    Add Expense
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-gray-800">Recent Bills</h2>
              {bills.length === 0 ? (
                <div className="bg-white rounded-xl shadow-md p-12 text-center">
                  <FileText size={48} className="mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500">No bills yet!</p>
                </div>
              ) : (
                bills.slice(0, 5).map(bill => (
                  <div key={bill.id} className="bg-white rounded-xl shadow-md p-6">
                    <div className="flex items-start space-x-4">
                      {bill.image ? (
                        <img src={bill.image} alt="Bill" className="w-32 h-32 object-cover rounded-lg" />
                      ) : (
                        <div className="w-32 h-32 bg-gray-100 rounded-lg flex items-center justify-center">
                          <FileText size={32} className="text-gray-400" />
                        </div>
                      )}
                      <div className="flex-1">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <label className="text-sm text-gray-500">Organization</label>
                            <input
                              type="text"
                              value={bill.organization}
                              onChange={(e) => updateBill(bill.id, 'organization', e.target.value)}
                              className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg"
                            />
                          </div>
                          <div>
                            <label className="text-sm text-gray-500">Amount</label>
                            <input
                              type="number"
                              step="0.01"
                              value={bill.amount}
                              onChange={(e) => updateBill(bill.id, 'amount', parseFloat(e.target.value) || 0)}
                              className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg"
                            />
                          </div>
                          <div>
                            <label className="text-sm text-gray-500">Tip</label>
                            <input
                              type="number"
                              step="0.01"
                              value={bill.tip}
                              onChange={(e) => updateBill(bill.id, 'tip', parseFloat(e.target.value) || 0)}
                              className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg"
                            />
                          </div>
                        </div>
                        <div className="flex justify-between items-center mt-4">
                          <p className="text-sm text-gray-500">
                            {new Date(bill.date).toLocaleDateString()}
                          </p>
                          <button
                            onClick={() => deleteBill(bill.id)}
                            className="text-red-500 hover:text-red-700"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'expenses' && (
          <div>
            <div className="bg-white rounded-xl shadow-md p-8 mb-8">
              <h2 className="text-xl font-semibold mb-6 text-gray-800 text-center">Spending Meter</h2>
              <div className="flex flex-col items-center">
                <svg width="300" height="180" viewBox="0 0 300 180">
                  <path d="M 30 150 A 120 120 0 0 1 270 150" fill="none" stroke="#e5e7eb" strokeWidth="20" strokeLinecap="round" />
                  <path d="M 30 150 A 120 120 0 0 1 90 50" fill="none" stroke="#10b981" strokeWidth="20" strokeLinecap="round" />
                  <path d="M 90 50 A 120 120 0 0 1 150 30" fill="none" stroke="#fbbf24" strokeWidth="20" strokeLinecap="round" />
                  <path d="M 150 30 A 120 120 0 0 1 210 50" fill="none" stroke="#f59e0b" strokeWidth="20" strokeLinecap="round" />
                  <path d="M 210 50 A 120 120 0 0 1 270 150" fill="none" stroke="#ef4444" strokeWidth="20" strokeLinecap="round" />
                  
                  {(() => {
                    const maxExpense = 1000;
                    const total = getTotalExpenses();
                    const percentage = Math.min((total / maxExpense) * 100, 100);
                    const theta = Math.PI * (1 - percentage / 100);
                    const radius = 100;
                    const needleX = 150 + radius * Math.cos(theta);
                    const needleY = 150 - radius * Math.sin(theta);
                    
                    return (
                      <>
                        <line x1="150" y1="150" x2={needleX} y2={needleY} stroke="#1f2937" strokeWidth="3" strokeLinecap="round" />
                        <circle cx="150" cy="150" r="8" fill="#1f2937" />
                        <circle cx="150" cy="150" r="4" fill="#ffffff" />
                      </>
                    );
                  })()}
                  
                  <text x="30" y="170" fontSize="12" fill="#6b7280" textAnchor="middle">$0</text>
                  <text x="150" y="20" fontSize="12" fill="#6b7280" textAnchor="middle">$500</text>
                  <text x="270" y="170" fontSize="12" fill="#6b7280" textAnchor="middle">$1000+</text>
                </svg>
                
                <div className="text-center mt-4">
                  <p className="text-4xl font-bold text-indigo-600">${getTotalExpenses().toFixed(2)}</p>
                  <p className="text-sm text-gray-500 mt-1">Total Expenses</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-white rounded-xl shadow-md p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Total Expenses</p>
                    <p className="text-3xl font-bold text-gray-800">${getTotalExpenses().toFixed(2)}</p>
                  </div>
                  <div className="bg-indigo-100 p-3 rounded-full">
                    <DollarSign className="text-indigo-600" size={24} />
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-xl shadow-md p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Total Tips</p>
                    <p className="text-3xl font-bold text-gray-800">${getTotalTips().toFixed(2)}</p>
                  </div>
                  <div className="bg-green-100 p-3 rounded-full">
                    <TrendingUp className="text-green-600" size={24} />
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-xl shadow-md p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Bills</p>
                    <p className="text-3xl font-bold text-gray-800">{bills.length}</p>
                  </div>
                  <div className="bg-purple-100 p-3 rounded-full">
                    <FileText className="text-purple-600" size={24} />
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-md p-6">
              <h2 className="text-xl font-semibold mb-4 text-gray-800">All Expenses</h2>
              {bills.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-500">No expenses yet</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Date</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Organization</th>
                        <th className="text-right py-3 px-4 text-sm font-semibold text-gray-600">Amount</th>
                        <th className="text-right py-3 px-4 text-sm font-semibold text-gray-600">Tip</th>
                        <th className="text-right py-3 px-4 text-sm font-semibold text-gray-600">Total</th>
                        <th className="text-right py-3 px-4 text-sm font-semibold text-gray-600">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bills.map(bill => (
                        <tr key={bill.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-3 px-4 text-sm text-gray-600">
                            {new Date(bill.date).toLocaleDateString()}
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-800">{bill.organization}</td>
                          <td className="py-3 px-4 text-sm text-right text-gray-800">${bill.amount.toFixed(2)}</td>
                          <td className="py-3 px-4 text-sm text-right text-gray-600">${bill.tip.toFixed(2)}</td>
                          <td className="py-3 px-4 text-sm text-right font-semibold text-gray-800">
                            ${(bill.amount + bill.tip).toFixed(2)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button onClick={() => deleteBill(bill.id)} className="text-red-500 hover:text-red-700">
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'assistant' && (
          <div className="bg-white rounded-xl shadow-md h-[600px] flex flex-col">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-800">AI Expense Assistant</h2>
              <p className="text-sm text-gray-500 mt-1">Powered by OpenAI</p>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {chatMessages.length === 0 && (
                <div className="text-center text-gray-400 mt-20">
                  <MessageSquare size={48} className="mx-auto mb-4 opacity-50" />
                  <p>Ask me about your expenses!</p>
                </div>
              )}
              {chatMessages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] rounded-lg px-4 py-3 ${
                    msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {isChatLoading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-lg px-4 py-3">
                    <div className="flex space-x-2">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="p-4 border-t border-gray-200">
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={userMessage}
                  onChange={(e) => setUserMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
                  placeholder="Ask about your expenses..."
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <button
                  onClick={sendChatMessage}
                  disabled={isChatLoading || !userMessage.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white px-6 py-2 rounded-lg"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>
            
          </div>
        )}
      </div>
    </div>
  );
};

export default ExpenseTrackerApp;