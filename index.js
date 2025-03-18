const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const User = require('./models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const Blog = require('./models/Blogs');
const CommentsModel = require('./models/Comments');
const Clap = require('./models/Clap');

require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

mongoose.connect(process.env.MONGO_URI, {
  // useNewUrlParser: true,
  // useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000, // 30 seconds
  socketTimeoutMS: 45000,         // 45 seconds
});

const storeItems = new Map([
  [1, {priceInCents: 1195, name: 'Subscribe to annual Premium plan'}],
  [2, {priceInCents: 1795, name: 'Subscribe to annual Business plan'}],
  [3, {priceInCents: 4759, name: 'Subscribe to annual Partner plan'}],
]);

const uploadMiddleware = multer({ dest: 'uploads/' });
const secret = process.env.JWT_SECRET
const salt = bcrypt.genSaltSync(10);

const uploadsPath = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath);
}


const app = express();

const allowedOrigins = [
  'http://localhost:3000',
  'https://splendid-dodol-d7eafa.netlify.app'
];

//app.use(cors({ credentials: true, origin: `${process.env.SERVER_URL}` }));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, origin);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(__dirname + '/uploads'))
//app.use(express.static(path.join(__dirname, 'build')));

app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  next();
});


app.post('/register', async (req, res) => {
  try {
  const { fullName, username, password } = req.body;

  if (!fullName || !username || !password) {
    return res.status(400).json({ error: 'All fields are required: fullName, username, and password' });
  }

  const existingUser = await User.findOne({ username });
  if (existingUser) {
    return res.status(400).json({ error: 'Username already exists' });
  }
  const userDoc = await User.create({ 
    fullName,
    username, 
    password: bcrypt.hashSync(password, salt),
  });
  res.status(201).json({
    id: userDoc._id,
    fullName: userDoc.fullName,
    username: userDoc.username,
  });
  } catch(error) {
    console.error('Error registering user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.post('/login', async(req, res) => {
  try {
  const { fullName, username, password } = req.body;
  const userDoc = await User.findOne({username, fullName});

  if (!userDoc) {
    return res.status(400).json({ message: 'User not found' });
  }

  const passOk = bcrypt.compareSync(password, userDoc.password);

  if (!passOk) {
    return res.status(400).json({ message: 'Wrong password' });
  } else {
    jwt.sign({ username, id: userDoc._id, fullName: userDoc.fullName }, secret, {}, (err, token) =>{
      if(err) {
        res.status(500).json({ message: 'Error generating token' });
      }
   
      res.cookie('token', token, {
        httpOnly: true,
        secure: true,
        maxAge: 30*24*60*60*1000
      }).json({message:'ok', token});

      
    });
  }
} catch (error) {
    res.status(500).json({ message: 'Internal server error' });
}
});

app.get('/profile', (req, res) => {
  const { token } = req.cookies;

  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  jwt.verify(token, secret, {}, (err, decodedInfo) => {
    if(err) {
      return res.status(403).json({ message: 'Invalid or expired token.' })
    }
    res.json({
      username: decodedInfo.username,
      id: decodedInfo.id,
      fullName: decodedInfo.fullName
    });
    
    console.log('Decoded token:', decodedInfo);
  });
});

// app.post('/logout', (req, res) => {
//   res.cookie('token', '').json('ok');
// });

app.post('/published-posts', uploadMiddleware.single('file'),  async(req, res) => {
  const { originalname, path } = req.file;
  const parts = originalname.split('.');
  const ext = parts[parts.length - 1]
  const newPath = path+'.'+ext;
  fs.renameSync(path, newPath);

  const { token } = req.cookies;
  jwt.verify(token, secret, {}, async (err, decodedInfo) => {
    if(err) {
      return res.status(403).json({ message: 'Invalid or expired token.' })
    }
    const { title, story } = req.body;
    const blogDoc = await Blog.create({
    title,
    story,
    cover: newPath,
    author: decodedInfo.id
  });

  res.json(blogDoc);
  });

});

app.get('/published-posts', async (req, res) =>{

  //const { blogId } = req.params;
try {
  const blogs = await Blog.find()
    .populate('author', ['fullName'])
    .populate('comments') // Populate comments if needed
    .sort({ createdAt: -1 })
    .limit(20);

    // Add commentCount to each blog
    const blogsWithCounts = blogs.map(blog => ({
      ...blog.toObject(),
      commentCount: blog.comments.length, // Assuming comments is an array
    }));

  res.json(blogsWithCounts);
}catch (error) {
    console.error('Error fetching blogs:', error);
    res.status(500).json({ error: 'Failed to fetch blogs' });
  }
 
});

app.post('/payment-checkout', async(req,res) => {
  try {
    const items = req.body.items;
    if (!items || items.length !== 1) {
      return res.status(400).json({ error: "Invalid items data. Only one plan is allowed." });
    }

    const item = items[0]; // Retrieve the selected plan
    const storeItem = storeItems.get(item.id);

    if (!storeItem) {
      return res.status(404).json({ error: "Plan not found." });
    }

    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return res.status(400).json({ error: "Invalid quantity. Quantity must be a positive integer." });
    }

    if (!process.env.SERVER_URL) {
      throw new Error("SERVER_URL is not configured in the environment.");
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: req.body.items.map(item => {
        const storeItem = storeItems.get(item.id);
        return {
          price_data: {
            currency: 'usd',
            product_data: { 
              name: storeItem.name 
            },
            unit_amount: storeItem.priceInCents
          },
          quantity: item.quantity
        }
      }),
      success_url: `${process.env.SERVER_URL}/published-posts`,
      cancel_url: `${process.env.SERVER_URL}/`
    })
    res.json({ url: session.url })
  }catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// Middleware to verify token
const verifyToken = (req, res, next) => {
  console.log('Incoming Cookies:', req.cookies); // Ensure cookies contain the token

  const token = req.cookies.token;

  if (!token) {
    console.error('Token missing');
    return res.status(401).json({ message: 'Unauthorized' });
  }  

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      console.error('JWT Verification Error:', err.message);
      return res.status(403).json({ message: 'Invalid token' });
    }
    req.user = decoded; // Attach decoded user info to the request
    console.log('Decoded Token:', decoded);
    next();
  });
};


// Create a comment
app.post('/comments', verifyToken, async (req, res) => {
  try {
    console.log('Request Body:', req.body);
    const { comment, blogId } = req.body;
    const author = req.user?.id;

    if (!author) return res.status(400).json({ message: 'Author is required' });


    if (!comment || !blogId || !author) {
      return res.status(400).json({ error: 'Comment and blogId are required' });
    }

    const newComment = new CommentsModel({ comment, blogId, author: req.user.id });
    await newComment.save();

    // Increment commentCount on the Blog model
    const blog = await Blog.findById(blogId);
    if (blog) {
      blog.commentCount = (blog.commentCount || 0) + 1;
      await blog.save();
    }

    res.status(201).json({
      message: 'Comment created successfully',
      comment: newComment,
      updatedCommentCount: blog.commentCount,  // Include updated comment count
    });
  } catch (err) {
    console.error('Error creating comment:', err); // Log the actual error
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

// Get all comments
app.get('/comments/:blogId', async (req, res) => {
  console.log('Request body:', req.body);
  try {
    const {blogId} = req.params;
    const { page = 1, limit = 10 } = req.query;
    const comments = await CommentsModel.find({blogId})
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .populate('author', 'fullName')
      .sort({ createdAt: -1 });
    res.status(200).json(comments);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

//comment count for a specific blog
app.get('/comments/:blogId/count', async (req, res) => {
  try {
    const { blogId } = req.params;
    const commentCount = await CommentsModel.countDocuments({ blogId });
    res.json({ commentCount });
  } catch (error) {
    console.error('Error fetching comment count:', error);
    res.status(500).json({ error: 'Failed to fetch comment count' });
  }
});


//This endpoint allows a user to clap for a blog post. It ensures that a user can only clap once for a blog post.
app.post('/claps', verifyToken, async (req, res) => {
  const { blogId } = req.body;

    if (!blogId) {
      return res.status(400).json({ error: 'Blog ID is required' });
    }

  try {
    const userId = req.user.id;

    // Check if the user has already clapped for this blog
    const existingClap = await Clap.findOne({ userId, blogId });

    if (existingClap) {
      return res.status(400).json({ error: 'You have already clapped for this blog' });
    }

     // Fetch the blog
    const blog = await Blog.findById(blogId);
    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    // Increment clap count in the Blog model
    blog.clapCount = (blog.clapCount || 0) + 1;
    await blog.save();

    
    // Create a new clap
    const newClap = await Clap.create({ userId, blogId });
    // const newClap = new Clap({ userId, blogId });
    // await newClap.save();

    res.status(201).json({ message: 'Clap added successfully', clapCount: blog.clapCount, clap: newClap });
  } catch (err) {
    console.error('Error adding clap:', err);
    res.status(500).json({ error: 'Failed to add clap' });
  }
});

//This endpoint retrieves the total number of claps for a specific blog post.
app.get('/claps/:blogId', async (req, res) => {
  try {
    const { blogId } = req.params;

    if (!blogId) {
      return res.status(400).json({ error: 'Blog ID is required' });
    }

    // Count the number of claps for the blog
    const totalClaps = await Clap.countDocuments({ blogId });

    res.status(200).json({ blogId, totalClaps });
  } catch (err) {
    console.error('Error fetching claps:', err);
    res.status(500).json({ error: 'Failed to fetch claps' });
  }
});

//This endpoint allows a user to remove their clap from a blog post.
app.delete('/claps', verifyToken, async (req, res) => {
  try {
    const { blogId } = req.body;

    if (!blogId) {
      return res.status(400).json({ error: 'Blog ID is required' });
    }

    const userId = req.user.id;

    // Find and delete the clap
    const deletedClap = await Clap.findOneAndDelete({ userId, blogId });

    if (!deletedClap) {
      return res.status(404).json({ error: 'Clap not found' });
    }

    res.status(200).json({ message: 'Clap removed successfully' });
  } catch (err) {
    console.error('Error removing clap:', err);
    res.status(500).json({ error: 'Failed to remove clap' });
  }
});

//This optional endpoint retrieves all claps added by the currently authenticated user.
app.get('/claps/user', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Find all claps by the user
    const userClaps = await Clap.find({ userId }).populate('blogId', 'title');

    res.status(200).json(userClaps);
  } catch (err) {
    console.error('Error fetching user claps:', err);
    res.status(500).json({ error: 'Failed to fetch user claps' });
  }
});

// app.get('*', (req, res) => {
//   res.sendFile(path.join(__dirname, 'build', 'index.html'));
// });

// Increment commentCount for a blog
// app.put('/comments/:id/commentCount', async (req, res) => {
//   const { id } = req.params;

//   try {
//     const blog = await Blog.findById(id);
//     if (!blog) {
//       return res.status(404).json({ error: 'Blog not found' });
//     }

//     blog.commentCount = blog.commentCount + 1; // Increment count
//     await blog.save();

//     res.json({ success: true, commentCount: blog.commentCount });
//   } catch (err) {
//     console.error('Error updating comment count:', err);
//     res.status(500).json({ error: 'Failed to update comment count' });
//   }
// });

module.exports = (req, res) => {
  res.status(200).send("Hello from Vercel!");
};


module.exports = app;

const port = process.env.PORT || 4000;

app.listen(port);
