
const express = require('express');
const router = express.Router();
const { check, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Tweet = require('../models/Tweet');

// @route   POST /api/users/register
// @desc    Register a user
// @access  Public
router.post(
  '/register',
  [
    check('name', 'Name is required').not().isEmpty(),
    check('username', 'Username is required').not().isEmpty(),
    check('email', 'Please include a valid email').isEmail(),
    check('password', 'Password must be at least 6 characters').isLength({ min: 6 })
  ],
  async (req, res) => {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { name, username, email, password } = req.body;

    try {
      // Check if user already exists
      let userByEmail = await User.findOne({ email });
      if (userByEmail) {
        return res.status(400).json({
          success: false,
          message: 'Email already in use'
        });
      }

      let userByUsername = await User.findOne({ username });
      if (userByUsername) {
        return res.status(400).json({
          success: false,
          message: 'Username already taken'
        });
      }

      // Create new user
      const user = new User({
        name,
        username,
        email,
        password
      });

      await user.save();

      // Generate JWT token
      const token = jwt.sign(
        { id: user.id },
        process.env.JWT_SECRET,
        { expiresIn: '30d' }
      );

      res.status(201).json({
        success: true,
        token,
        user
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  }
);

// @route   POST /api/users/login
// @desc    Login user & get token
// @access  Public
router.post(
  '/login',
  [
    check('email', 'Please include a valid email').isEmail(),
    check('password', 'Password is required').exists()
  ],
  async (req, res) => {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { email, password } = req.body;

    try {
      // Check if user exists
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(400).json({
          success: false,
          message: 'Invalid credentials'
        });
      }

      // Check password
      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: 'Invalid credentials'
        });
      }

      // Generate JWT token
      const token = jwt.sign(
        { id: user.id },
        process.env.JWT_SECRET,
        { expiresIn: '30d' }
      );

      res.json({
        success: true,
        token,
        user
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  }
);

// @route   GET /api/users/me
// @desc    Get current user
// @access  Private
router.get('/me', auth, async (req, res) => {
  try {
    res.json({
      success: true,
      user: req.user
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/users/profile/:username
// @desc    Get user profile by username
// @access  Private
router.get('/profile/:username', auth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Count tweets, following, followers
    const tweetsCount = await Tweet.countDocuments({ 
      user: user._id,
      retweetData: { $exists: false }
    });
    
    const followingCount = user.following.length;
    const followersCount = user.followers.length;
    
    // Check if current user is following this user
    const isFollowing = req.user.following.includes(user._id);

    res.json({
      success: true,
      user: {
        ...user.toJSON(),
        tweetsCount,
        followingCount,
        followersCount,
        isFollowing
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/users/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', auth, async (req, res) => {
  try {
    const { name, bio, location, website, profileImage, coverImage } = req.body;
    
    // Build profile object
    const profileFields = {};
    if (name) profileFields.name = name;
    if (bio) profileFields.bio = bio;
    if (location) profileFields.location = location;
    if (website) profileFields.website = website;
    if (profileImage) profileFields.profileImage = profileImage;
    if (coverImage) profileFields.coverImage = coverImage;
    
    // Update user
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: profileFields },
      { new: true }
    );
    
    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/users/:id/follow
// @desc    Follow a user
// @access  Private
router.post('/:id/follow', auth, async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot follow yourself'
      });
    }
    
    const userToFollow = await User.findById(req.params.id);
    
    if (!userToFollow) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Check if already following
    if (req.user.following.includes(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'You are already following this user'
      });
    }
    
    // Add to following
    await User.findByIdAndUpdate(req.user.id, {
      $push: { following: req.params.id }
    });
    
    // Add to followers
    await User.findByIdAndUpdate(req.params.id, {
      $push: { followers: req.user.id }
    });
    
    res.json({
      success: true,
      message: 'User followed successfully'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/users/:id/unfollow
// @desc    Unfollow a user
// @access  Private
router.post('/:id/unfollow', auth, async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot unfollow yourself'
      });
    }
    
    const userToUnfollow = await User.findById(req.params.id);
    
    if (!userToUnfollow) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Check if following
    if (!req.user.following.includes(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'You are not following this user'
      });
    }
    
    // Remove from following
    await User.findByIdAndUpdate(req.user.id, {
      $pull: { following: req.params.id }
    });
    
    // Remove from followers
    await User.findByIdAndUpdate(req.params.id, {
      $pull: { followers: req.user.id }
    });
    
    res.json({
      success: true,
      message: 'User unfollowed successfully'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/users/suggestions
// @desc    Get user suggestions (who to follow)
// @access  Private
router.get('/suggestions', auth, async (req, res) => {
  try {
    // Find users that the current user is not following
    const users = await User.find({
      _id: { $ne: req.user.id, $nin: req.user.following },
    })
    .select('_id name username profileImage bio')
    .limit(5);
    
    // Add isFollowing property
    const usersWithFollowInfo = users.map(user => ({
      ...user.toJSON(),
      isFollowing: false
    }));
    
    res.json({
      success: true,
      users: usersWithFollowInfo
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/users
// @desc    Search users or get followers/following
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const { query, type, userId, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;
    
    let users = [];
    
    if (type === 'followers' && userId) {
      // Get user's followers
      const user = await User.findById(userId).populate({
        path: 'followers',
        select: '_id name username profileImage bio',
        options: { skip, limit }
      });
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      
      users = user.followers;
    } 
    else if (type === 'following' && userId) {
      // Get who user is following
      const user = await User.findById(userId).populate({
        path: 'following',
        select: '_id name username profileImage bio',
        options: { skip, limit }
      });
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      
      users = user.following;
    } 
    else if (query) {
      // Search users by name or username
      users = await User.find({
        $or: [
          { name: { $regex: query, $options: 'i' } },
          { username: { $regex: query, $options: 'i' } }
        ],
        _id: { $ne: req.user.id }
      })
      .select('_id name username profileImage bio')
      .skip(skip)
      .limit(parseInt(limit));
    } 
    else {
      // Get all users (except current user)
      users = await User.find({ _id: { $ne: req.user.id } })
        .select('_id name username profileImage bio')
        .skip(skip)
        .limit(parseInt(limit));
    }
    
    // Add isFollowing property to each user
    const usersWithFollowInfo = users.map(user => ({
      ...user.toJSON ? user.toJSON() : user,
      isFollowing: req.user.following.includes(user._id)
    }));
    
    res.json({
      success: true,
      users: usersWithFollowInfo
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;
